// Built by install-desktop.ps1 with the Windows .NET compiler. No external runtime.
using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace MeuKeymapDesktop
{
    internal sealed class OwnedJob : IDisposable
    {
        private IntPtr handle;
        internal OwnedJob()
        {
            handle = Native.CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) throw new Win32Exception();
            var limit = new Native.ExtendedLimit();
            limit.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            int size = Marshal.SizeOf(limit);
            IntPtr memory = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(limit, memory, false);
                if (!Native.SetInformationJobObject(handle, 9, memory, (uint)size)) throw new Win32Exception();
            }
            finally { Marshal.FreeHGlobal(memory); }
        }
        internal Process Start(string executable, string arguments, string cwd, Dictionary<string, string> additions)
        {
            var environment = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (DictionaryEntry item in Environment.GetEnvironmentVariables()) environment[(string)item.Key] = (string)item.Value;
            // Do not leak launcher credentials into the browser or user commands.
            environment.Remove("KEYMAP_DESKTOP_TOKEN");
            foreach (var item in additions) environment[item.Key] = item.Value;
            string block = String.Join("\0", environment.Select(item => item.Key + "=" + item.Value)) + "\0\0";
            IntPtr env = Marshal.StringToHGlobalUni(block);
            var startup = new Native.StartupInfo();
            startup.Size = Marshal.SizeOf(startup);
            Native.ProcessInfo child;
            try
            {
                if (!Native.CreateProcess(executable, new StringBuilder(Quote(executable) + " " + arguments), IntPtr.Zero, IntPtr.Zero,
                    false, 0x00000004 | 0x08000000 | 0x00000400, env, cwd, ref startup, out child)) throw new Win32Exception();
            }
            finally { Marshal.FreeHGlobal(env); }
            try
            {
                if (!Native.AssignProcessToJobObject(handle, child.Process))
                {
                    Native.TerminateProcess(child.Process, 1);
                    throw new Win32Exception();
                }
                if (Native.ResumeThread(child.Thread) == UInt32.MaxValue)
                {
                    Native.TerminateProcess(child.Process, 1);
                    throw new Win32Exception();
                }
                return Process.GetProcessById((int)child.ProcessId);
            }
            finally { Native.CloseHandle(child.Thread); Native.CloseHandle(child.Process); }
        }
        internal static string Quote(string value)
        {
            // Windows CommandLineToArgvW escaping, including trailing backslashes.
            var result = new StringBuilder("\""); int slashes = 0;
            foreach (char c in value)
            {
                if (c == '\\') { slashes++; continue; }
                if (c == '"') result.Append('\\', slashes * 2 + 1);
                else result.Append('\\', slashes);
                result.Append(c); slashes = 0;
            }
            return result.Append('\\', slashes * 2).Append('"').ToString();
        }
        public void Dispose() { if (handle != IntPtr.Zero) { Native.CloseHandle(handle); handle = IntPtr.Zero; } }
    }

    internal static class Launcher
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static string root, stateDirectory, logPath;
        private static Dictionary<string, object> config;
        private static int port;
        private static string session;
        private static Dictionary<string, object> descriptor;
        private static Process server;
        private static string Arg(string key, string fallback) { return config.ContainsKey(key) ? Convert.ToString(config[key]) : fallback; }
        private static bool Alive(Process process) { try { return process != null && !process.HasExited; } catch { return false; } }
        private static void Log(string kind, object details)
        {
            File.AppendAllText(logPath, Json.Serialize(new { at = DateTime.UtcNow.ToString("o"), session, kind, details }) + "\n", new UTF8Encoding(false));
        }
        private static string RandomToken()
        {
            byte[] bytes = new byte[32]; using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
            return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
        }
        private static Dictionary<string, object> Http(string path, string token, string method)
        {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + path);
            request.Proxy = null; request.Timeout = 2500; request.ReadWriteTimeout = 2500; request.Method = method;
            if (token != null) request.Headers["x-keymap-desktop-token"] = token;
            if (method == "POST") request.ContentLength = 0;
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream())) return Json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
        }
        private static bool SamePath(object value, string expected)
        { return String.Equals(Path.GetFullPath(Convert.ToString(value)), Path.GetFullPath(expected), StringComparison.OrdinalIgnoreCase); }
        private static Dictionary<string, object> ReadOwnedServer(string node, string data)
        {
            var value = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(stateDirectory, "server-" + port + ".json")));
            if (Convert.ToString(value["app"]) != "meu-keymap" || Convert.ToInt32(value["version"]) != 1 || Convert.ToInt32(value["port"]) != port
                || !SamePath(value["root"], root) || !SamePath(value["dataDirectory"], data)) throw new Exception("Identidade do servidor não corresponde a este projeto.");
            var process = Process.GetProcessById(Convert.ToInt32(value["pid"]));
            if (process.StartTime.ToUniversalTime().Ticks.ToString() != Convert.ToString(value["birth"]) || !SamePath(process.MainModule.FileName, node))
                throw new Exception("PID/birth/executável do servidor não correspondem ao registro.");
            var status = Http("/api/desktop/status", Convert.ToString(value["token"]), "GET");
            if (Convert.ToString(status["instance"]) != Convert.ToString(value["instance"]) || Convert.ToInt32(status["pid"]) != process.Id)
                throw new Exception("Ownership do endpoint mudou.");
            return value;
        }
        private static void ReplaceTechnicalServer(string node, string data)
        {
            // Reserve neither data nor hardware until an existing listener has been identified.
            bool listening = System.Net.NetworkInformation.IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners()
                .Any(endpoint => endpoint.Port == port);
            if (!listening) return;
            Dictionary<string, object> old;
            try { old = ReadOwnedServer(node, data); }
            catch (Exception error) { throw new Exception("A porta " + port + " está ocupada sem ownership comprovado. Nenhum processo foi encerrado. " + error.Message); }
            var reply = Http("/api/desktop/status", Convert.ToString(old["token"]), "GET");
            var status = (Dictionary<string, object>)reply["status"];
            var runtime = (Dictionary<string, object>)status["runtime"];
            var application = (Dictionary<string, object>)status["application"];
            var deviceState = (Dictionary<string, object>)application["deviceState"];
            var policy = (Dictionary<string, object>)deviceState["policy"];
            if (Convert.ToBoolean(runtime["active"]) || Convert.ToInt32(runtime["pending"]) != 0 || Convert.ToBoolean(application["busy"]) || Convert.ToBoolean(policy["enabled"]))
                throw new Exception("O servidor técnico está executando ações. Pare o motor antes de abrir a sessão desktop.");
            using (var oldProcess = Process.GetProcessById(Convert.ToInt32(old["pid"])))
            {
                Log("technical-server-graceful-replacement", new { pid = oldProcess.Id, birth = old["birth"], instance = old["instance"] });
                Http("/api/desktop/shutdown", Convert.ToString(old["token"]), "POST");
                if (!oldProcess.WaitForExit(15000)) throw new Exception("Servidor técnico não confirmou saída. Nenhum segundo servidor foi iniciado.");
            }
        }
        private static void SaveState(string phase)
        {
            var info = new { app = "meu-keymap", version = 1, session, phase, root, port,
                launcher = new { pid = Process.GetCurrentProcess().Id, birth = Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks.ToString() },
                server = Alive(server) ? new { pid = server.Id, birth = server.StartTime.ToUniversalTime().Ticks.ToString(), instance = descriptor == null ? null : descriptor["instance"] } : null,
                at = DateTime.UtcNow.ToString("o") };
            string target = Path.Combine(stateDirectory, "session.json"), temp = target + ".tmp";
            File.WriteAllText(temp, Json.Serialize(info), new UTF8Encoding(false));
            if (File.Exists(target)) File.Replace(temp, target, null); else File.Move(temp, target);
        }
        [STAThread]
        private static int Main(string[] args)
        {
            string settings = args.Length == 2 && args[0] == "--config" ? Path.GetFullPath(args[1]) : Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "launcher.json");
            try
            {
                config = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(settings));
                root = Path.GetFullPath(Arg("root", "")); stateDirectory = Path.GetFullPath(Arg("stateDirectory", Path.Combine(root, ".desktop")));
                port = Int32.Parse(Arg("port", "4173"));
                if (port < 1024 || port > 65535) throw new Exception("Porta inválida.");
                Directory.CreateDirectory(stateDirectory); logPath = Path.Combine(stateDirectory, "launcher.jsonl"); session = Guid.NewGuid().ToString();
                string sid = WindowsIdentity.GetCurrent().User.Value;
                // One session per Windows user, across checkouts. A duplicate requests another normal browser tab.
                using (var mutex = new Mutex(false, "Local\\MeuKeymap-" + sid))
                using (var focus = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\MeuKeymapFocus-" + sid))
                {
                    bool acquired;
                    try { acquired = mutex.WaitOne(0); } catch (AbandonedMutexException) { acquired = true; }
                    if (!acquired) { focus.Set(); return 0; }
                    try { Run(focus); } finally { mutex.ReleaseMutex(); }
                }
                return 0;
            }
            catch (Exception error)
            {
                if (logPath != null) try { Log("failure", new { error = error.Message }); } catch { }
                if (config == null || Arg("openBrowser", "true") != "false") MessageBox.Show(error.Message + "\n\nConfira .desktop/launcher.jsonl no projeto.", "Meu Keymap", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
        private static void OpenBrowser()
        {
            var reply = Http("/api/desktop/open", Convert.ToString(descriptor["token"]), "POST");
            string url = Convert.ToString(reply["url"]);
            if (url != "http://127.0.0.1:" + port + "/") throw new Exception("URL desktop inesperada.");
            if (Arg("openBrowser", "true") != "false")
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            Log("browser-open-requested", new { port, shell = Arg("openBrowser", "true") != "false" });
        }
        private static void Run(EventWaitHandle focus)
        {
            string node = Arg("node", ""), data = Path.GetFullPath(Arg("dataDirectory", Path.Combine(root, ".data")));
            if (!File.Exists(node)) throw new Exception("Node.js não encontrado. Execute install-desktop.ps1 novamente.");
            if (!File.Exists(Path.Combine(root, "dist", "index.html"))) throw new Exception("Compile o aplicativo primeiro: npm run build.");
            Log("starting", new { root, port, data });
            ReplaceTechnicalServer(node, data);
            using (var serverJob = new OwnedJob())
            {
                try
                {
                    string token = RandomToken();
                    server = serverJob.Start(node, OwnedJob.Quote(Path.Combine(root, "server.ts")) + " --production --desktop --port " + port + " --data-dir " + OwnedJob.Quote(data), root,
                        new Dictionary<string, string> { { "KEYMAP_DESKTOP_TOKEN", token } });
                    var deadline = DateTime.UtcNow.AddSeconds(35);
                    while (DateTime.UtcNow < deadline)
                    {
                        if (!Alive(server)) throw new Exception("O servidor não iniciou. Veja .desktop/server-error.log.");
                        try { var candidate = ReadOwnedServer(node, data); if (Convert.ToInt32(candidate["pid"]) == server.Id && Convert.ToString(candidate["token"]) == token) { descriptor = candidate; break; } }
                        catch { }
                        Thread.Sleep(150);
                    }
                    if (descriptor == null) throw new Exception("O servidor não respondeu no prazo.");
                    OpenBrowser();
                    Log("ready", new { serverPid = server.Id, browserOwnership = false, graceSeconds = 15, initialSeconds = 60 });
                    SaveState("ready");
                    int ticks = 0;
                    while (Alive(server))
                    {
                        if (focus.WaitOne(200) && Alive(server)) OpenBrowser();
                        if (++ticks % 10 == 0) SaveState("ready");
                    }
                    Log("server-exited", new { serverPid = server.Id, exitCode = server.ExitCode });
                    if (server.ExitCode != 0) throw new Exception("O servidor encerrou com erro. Os processos próprios foram encerrados; reabra pelo atalho.");
                }
                finally
                {
                    if (Alive(server) && descriptor != null && Convert.ToInt32(descriptor["pid"]) == server.Id)
                    {
                        try
                        {
                            Http("/api/desktop/shutdown", Convert.ToString(descriptor["token"]), "POST");
                            bool exited = server.WaitForExit(15000);
                            Log("shutdown", new { graceful = exited, serverPid = server.Id });
                        }
                        catch (Exception error) { Log("shutdown-fallback-owned-job", new { error = error.Message }); }
                    }
                    // Only server descendants belong to this private job. Browsers never enter it.
                    serverJob.Dispose();
                    if (server != null) server.WaitForExit(5000);
                    SaveState("closed");
                    Log("closed", new { serverExited = !Alive(server) });
                }
            }
        }
    }
    internal static class Native
    {
        [StructLayout(LayoutKind.Sequential)] internal struct BasicLimit { internal long PerProcess, PerJob; internal uint LimitFlags; internal UIntPtr Minimum, Maximum; internal uint Active; internal UIntPtr Affinity; internal uint Priority, Scheduling; }
        [StructLayout(LayoutKind.Sequential)] internal struct IoCounters { internal ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] internal struct ExtendedLimit { internal BasicLimit Basic; internal IoCounters Io; internal UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] internal struct StartupInfo { internal int Size; internal string Reserved, Desktop, Title; internal uint X, Y, Width, Height, XChars, YChars, Fill, Flags; internal short Show, Reserved2; internal IntPtr ReservedPtr, Input, Output, Error; }
        [StructLayout(LayoutKind.Sequential)] internal struct ProcessInfo { internal IntPtr Process, Thread; internal uint ProcessId, ThreadId; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr CreateJobObject(IntPtr security, string name);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetInformationJobObject(IntPtr job, int type, IntPtr info, uint length);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool CreateProcess(string app, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr env, string cwd, ref StartupInfo startup, out ProcessInfo info);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll")] internal static extern bool TerminateProcess(IntPtr process, uint code);
        [DllImport("kernel32.dll")] internal static extern bool CloseHandle(IntPtr handle);
    }
}
