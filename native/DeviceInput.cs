using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32.SafeHandles;

namespace MeuKeymap {
  public sealed class DeviceCollection {
    public string path;
    public string kind;
    public string product;
    public string manufacturer;
    public string serial;
    public int usagePage;
    public int usage;
    public int inputBytes;
    public int outputBytes;
    public int featureBytes;
    public int version;
  }
  public static class DeviceInput {
    const uint DeviceName = 0x20000007;
    [StructLayout(LayoutKind.Sequential)] internal struct Entry { public IntPtr handle; public uint type; }
    [StructLayout(LayoutKind.Sequential)] internal struct Registration { public ushort page, usage; public uint flags; public IntPtr target; }
    [StructLayout(LayoutKind.Sequential)] internal struct Header { public uint type, size; public IntPtr device, parameter; }
    [StructLayout(LayoutKind.Sequential)] struct Attributes { public int size; public ushort vendor, product, version; }
    [StructLayout(LayoutKind.Sequential)] struct Caps {
      public ushort usage, page, input, output, feature;
      [MarshalAs(UnmanagedType.ByValArray, SizeConst=17)] public ushort[] reserved;
      public ushort linkNodes, inputButtons, inputValues, inputIndices, outputButtons, outputValues, outputIndices, featureButtons, featureValues, featureIndices;
    }
    [DllImport("user32.dll", SetLastError=true)] static extern uint GetRawInputDeviceList([In, Out] Entry[] list, ref uint count, uint size);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetRawInputDeviceInfo(IntPtr device, uint command, StringBuilder data, ref uint size);
    [DllImport("user32.dll", SetLastError=true)] internal static extern bool RegisterRawInputDevices(Registration[] devices, uint count, uint size);
    [DllImport("user32.dll", SetLastError=true)] internal static extern uint GetRawInputData(IntPtr input, uint command, IntPtr data, ref uint size, uint headerSize);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("hid.dll")] static extern bool HidD_GetAttributes(SafeFileHandle device, ref Attributes attributes);
    [DllImport("hid.dll")] static extern bool HidD_GetPreparsedData(SafeFileHandle device, out IntPtr data);
    [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr data);
    [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr data, out Caps caps);
    [DllImport("hid.dll", CharSet=CharSet.Unicode)] static extern bool HidD_GetProductString(SafeFileHandle device, StringBuilder text, uint bytes);
    [DllImport("hid.dll", CharSet=CharSet.Unicode)] static extern bool HidD_GetManufacturerString(SafeFileHandle device, StringBuilder text, uint bytes);
    [DllImport("hid.dll", CharSet=CharSet.Unicode)] static extern bool HidD_GetSerialNumberString(SafeFileHandle device, StringBuilder text, uint bytes);

    internal static long Now() { return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); }
    public static bool IsTarget(string path) {
      if (path == null) return false;
      const string id="VID_514C&PID_8850";
      int index=path.IndexOf(id,StringComparison.OrdinalIgnoreCase), end=index+id.Length;
      return index >= 0 && (index == 0 || path[index-1] == '#' || path[index-1] == '\\') && (end == path.Length || path[end] == '&' || path[end] == '#' || path[end] == '\\');
    }
    internal static string PathFor(IntPtr handle) {
      uint size = 0;
      if (GetRawInputDeviceInfo(handle, DeviceName, null, ref size) == UInt32.MaxValue || size > 4096) return "";
      var text = new StringBuilder((int)size + 1);
      return GetRawInputDeviceInfo(handle, DeviceName, text, ref size) == UInt32.MaxValue ? "" : text.ToString();
    }
    public static DeviceCollection[] Enumerate() {
      uint count = 0, stride = (uint)Marshal.SizeOf(typeof(Entry));
      if (GetRawInputDeviceList(null, ref count, stride) == UInt32.MaxValue || count > 4096) throw new InvalidOperationException("Falha ao enumerar dispositivos de entrada.");
      Entry[] entries = new Entry[count];
      uint found = GetRawInputDeviceList(entries, ref count, stride);
      if (found == UInt32.MaxValue) throw new InvalidOperationException("Falha ao ler dispositivos de entrada.");
      var result = new List<DeviceCollection>();
      for (int i = 0; i < found; i++) {
        string path = PathFor(entries[i].handle);
        if (!IsTarget(path)) continue;
        var item = new DeviceCollection { path=path, kind=entries[i].type == 0 ? "mouse" : entries[i].type == 1 ? "keyboard" : "hid", product="", manufacturer="",serial="" };
        using (var handle = CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
          if (!handle.IsInvalid) {
            var attributes = new Attributes { size=Marshal.SizeOf(typeof(Attributes)) };
            if (HidD_GetAttributes(handle, ref attributes)) item.version = attributes.version;
            var text = new StringBuilder(127);
            if (HidD_GetProductString(handle, text, 254)) item.product = text.ToString();
            text = new StringBuilder(127);
            if (HidD_GetManufacturerString(handle, text, 254)) item.manufacturer = text.ToString();
            text = new StringBuilder(127);
            if (HidD_GetSerialNumberString(handle, text, 254)) item.serial = text.ToString();
            IntPtr parsed;
            if (HidD_GetPreparsedData(handle, out parsed)) {
              try {
                Caps caps;
                if (HidP_GetCaps(parsed, out caps) >= 0) {
                  item.usagePage=caps.page; item.usage=caps.usage;
                  item.inputBytes=caps.input; item.outputBytes=caps.output; item.featureBytes=caps.feature;
                }
              } finally { HidD_FreePreparsedData(parsed); }
            }
          }
        }
        result.Add(item);
      }
      return result.ToArray();
    }
    public static string Snapshot() { return new JavaScriptSerializer().Serialize(new { type="inventory", at=Now(), platform="win32", devices=Enumerate() }); }
    public static void Listen(int ownerPid) {
      using (var monitor = new InputWindow(ownerPid)) Application.Run();
    }
    sealed class InputWindow : NativeWindow, IDisposable {
      readonly JavaScriptSerializer json = new JavaScriptSerializer();
      readonly Timer timer = new Timer();
      readonly int ownerPid;
      readonly DateTime ownerStarted;
      readonly Dictionary<IntPtr,string> paths = new Dictionary<IntPtr,string>();
      readonly List<Registration> registrations = new List<Registration>();
      int ticks;
      bool disposed;
      public InputWindow(int parent) {
        ownerPid=parent; ownerStarted=Process.GetProcessById(parent).StartTime;
        CreateHandle(new CreateParams { Caption="meu keymap input monitor" });
        var pairs = new HashSet<string>();
        // Register known usages even when unplugged, so arrival is observed without a browser.
        var devices=new DeviceCollection[]{new DeviceCollection{usagePage=1,usage=6},new DeviceCollection{usagePage=1,usage=2},new DeviceCollection{usagePage=0xFF00,usage=1}};
        foreach (var item in devices) {
          ushort page=(ushort)item.usagePage, usage=(ushort)item.usage;
          if (page == 0 && item.kind == "keyboard") { page=1; usage=6; }
          if (page == 0 && item.kind == "mouse") { page=1; usage=2; }
          if (page == 0 || usage == 0 || !pairs.Add(page + ":" + usage)) continue;
          registrations.Add(new Registration { page=page, usage=usage, flags=0x2100, target=Handle });
        }
        if (registrations.Count == 0 || !RegisterRawInputDevices(registrations.ToArray(), (uint)registrations.Count, (uint)Marshal.SizeOf(typeof(Registration)))) {
          DestroyHandle();
          throw new InvalidOperationException("Nao foi possivel iniciar a observacao do macropad.");
        }
        Console.WriteLine(Snapshot());
        timer.Interval=500;
        timer.Tick += delegate {
          try { using (var owner=Process.GetProcessById(ownerPid)) if (owner.StartTime != ownerStarted) { Application.ExitThread(); return; } }
          catch { Application.ExitThread(); return; }
          if (++ticks % 2 == 0) { Emit(new { type="heartbeat", at=Now() }); try { Console.WriteLine(Snapshot()); } catch { Emit(new { type="error",at=Now(),message="Falha ao atualizar inventario do macropad." }); } }
        };
        timer.Start();
      }
      void Emit(object value) { Console.WriteLine(json.Serialize(value)); }
      protected override void WndProc(ref Message message) {
        if (message.Msg == 0x00FE) {
          string affected;
          if (!paths.TryGetValue(message.LParam,out affected)) affected=PathFor(message.LParam);
          paths.Remove(message.LParam);
          if (String.IsNullOrEmpty(affected) || IsTarget(affected)) {
            try { Console.WriteLine(Snapshot()); } catch { Emit(new { type="error", at=Now(), message="Falha ao atualizar os dispositivos." }); }
          }
        }
        if (message.Msg == 0x00FF) {
          try { Read(message.LParam); } catch { Emit(new { type="error", at=Now(), message="Falha ao ler um evento do macropad." }); }
        }
        base.WndProc(ref message);
      }
      void Read(IntPtr input) {
        uint size=0, headerSize=(uint)Marshal.SizeOf(typeof(Header));
        if (GetRawInputData(input, 0x10000003, IntPtr.Zero, ref size, headerSize) == UInt32.MaxValue || size < headerSize || size > 65536) return;
        IntPtr buffer=Marshal.AllocHGlobal((int)size);
        try {
          if (GetRawInputData(input, 0x10000003, buffer, ref size, headerSize) == UInt32.MaxValue) return;
          var header=(Header)Marshal.PtrToStructure(buffer, typeof(Header));
          string path;
          if (!paths.TryGetValue(header.device, out path)) { path=PathFor(header.device); paths[header.device]=path; }
          if (!IsTarget(path)) return;
          IntPtr body=IntPtr.Add(buffer, (int)headerSize);
          var data=new Dictionary<string,object>();
          string kind;
          if (header.type == 1 && size >= headerSize + 16) {
            kind="keyboard";
            data["scan"]=(ushort)Marshal.ReadInt16(body,0); data["flags"]=(ushort)Marshal.ReadInt16(body,2);
            data["vkey"]=(ushort)Marshal.ReadInt16(body,6); data["released"]=(((ushort)data["flags"]) & 1) != 0;
            data["modifiers"]=(GetAsyncKeyState(17)<0?1:0)|(GetAsyncKeyState(16)<0?2:0)|(GetAsyncKeyState(18)<0?4:0)|((GetAsyncKeyState(91)<0||GetAsyncKeyState(92)<0)?8:0);
          } else if (header.type == 0 && size >= headerSize + 24) {
            kind="mouse";
            ushort flags=(ushort)Marshal.ReadInt16(body,4);
            if (flags == 0) return;
            data["buttons"]=flags; data["wheel"]=(short)Marshal.ReadInt16(body,6);
          } else if (header.type == 2 && size >= headerSize + 8) {
            kind="hid";
            uint length=(uint)Marshal.ReadInt32(body,0), count=(uint)Marshal.ReadInt32(body,4);
            if (length == 0 || length > 4096 || count == 0 || count > 32 || (ulong)length*count+8 > size-headerSize) return;
            int bytes=(int)Math.Min((ulong)length*count,128UL);
            var raw=new byte[bytes]; Marshal.Copy(IntPtr.Add(body,8),raw,0,bytes);
            if(raw.Length>1&&raw[0]==3&&(raw[1]==0xFA||raw[1]==0xFB))return;
            data["hex"]=BitConverter.ToString(raw).Replace("-",""); data["reportBytes"]=length; data["reports"]=count;
          } else return;
          Emit(new { type="input", at=Now(), devicePath=path, kind=kind, data=data });
        } finally { Marshal.FreeHGlobal(buffer); }
      }
      public void Dispose() {
        if (disposed) return;
        disposed=true; timer.Stop(); timer.Dispose();
        var remove=new List<Registration>();
        foreach (var entry in registrations) remove.Add(new Registration { page=entry.page, usage=entry.usage, flags=1, target=IntPtr.Zero });
        if (remove.Count > 0) RegisterRawInputDevices(remove.ToArray(),(uint)remove.Count,(uint)Marshal.SizeOf(typeof(Registration)));
        DestroyHandle();
      }
    }
  }
}
