using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace MeuKeymap {
  public sealed class PlaybackMute {
    public interface Output : IDisposable {
      bool Muted { get; set; }
    }

    readonly Func<IEnumerable<Output>> enumerate;
    readonly HashSet<int> slots = new HashSet<int>();
    readonly List<Output> changed = new List<Output>();

    public PlaybackMute() : this(ActiveOutputs) {}
    public PlaybackMute(Func<IEnumerable<Output>> enumerate) { this.enumerate = enumerate; }

    public void Press(int slot) {
      if (!slots.Add(slot) || slots.Count != 1) return;
      var errors = new List<Exception>();
      foreach (var output in enumerate()) {
        bool owned = false;
        try {
          if (output.Muted) continue;
          output.Muted = true;
          changed.Add(output);
          owned = true;
        } catch (Exception error) { errors.Add(error); }
        finally { if (!owned) output.Dispose(); }
      }
      if (errors.Count > 0) throw new InvalidOperationException("Falha ao silenciar uma saída de áudio.", errors[0]);
    }

    public void Release(int slot) {
      if (!slots.Remove(slot) || slots.Count > 0) return;
      Restore();
    }

    public void Clear() {
      slots.Clear();
      try { Restore(); }
      finally {
        foreach (var output in changed) output.Dispose();
        changed.Clear();
      }
    }

    void Restore() {
      Exception failure = null;
      for (int i = changed.Count - 1; i >= 0; i--) {
        var output = changed[i];
        try { output.Muted = false; }
        catch (Exception error) { failure = error; continue; }
        changed.RemoveAt(i);
        output.Dispose();
      }
      if (failure != null) throw new InvalidOperationException("Falha ao restaurar uma saída de áudio.", failure);
    }

    static IEnumerable<Output> ActiveOutputs() {
      var enumerator = (DeviceEnumerator)new MMDeviceEnumerator();
      DeviceCollection collection = null;
      try {
        enumerator.EnumAudioEndpoints(0, 1, out collection); // eRender, DEVICE_STATE_ACTIVE
        uint count;
        collection.GetCount(out count);
        for (uint i = 0; i < count; i++) {
          Device device;
          collection.Item(i, out device);
          try {
            object endpoint;
            var guid = typeof(EndpointVolume).GUID;
            device.Activate(ref guid, 23, IntPtr.Zero, out endpoint); // CLSCTX_ALL
            yield return new CoreAudioOutput((EndpointVolume)endpoint);
          } finally { Marshal.ReleaseComObject(device); }
        }
      } finally {
        if (collection != null) Marshal.ReleaseComObject(collection);
        Marshal.ReleaseComObject(enumerator);
      }
    }

    sealed class CoreAudioOutput : Output {
      readonly EndpointVolume volume;
      public CoreAudioOutput(EndpointVolume volume) { this.volume = volume; }
      public bool Muted {
        get { bool value; volume.GetMute(out value); return value; }
        set { volume.SetMute(value, IntPtr.Zero); }
      }
      public void Dispose() { Marshal.ReleaseComObject(volume); }
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumerator {}

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface DeviceEnumerator {
      void EnumAudioEndpoints(int flow, uint state, out DeviceCollection devices);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface DeviceCollection {
      void GetCount(out uint count);
      void Item(uint index, out Device device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface Device {
      void Activate(ref Guid iid, uint scope, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object value);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface EndpointVolume {
      void RegisterControlChangeNotify(IntPtr notify);
      void UnregisterControlChangeNotify(IntPtr notify);
      void GetChannelCount(out uint count);
      void SetMasterVolumeLevel(float level, IntPtr context);
      void SetMasterVolumeLevelScalar(float level, IntPtr context);
      void GetMasterVolumeLevel(out float level);
      void GetMasterVolumeLevelScalar(out float level);
      void SetChannelVolumeLevel(uint channel, float level, IntPtr context);
      void SetChannelVolumeLevelScalar(uint channel, float level, IntPtr context);
      void GetChannelVolumeLevel(uint channel, out float level);
      void GetChannelVolumeLevelScalar(uint channel, out float level);
      void SetMute([MarshalAs(UnmanagedType.Bool)] bool muted, IntPtr context);
      void GetMute([MarshalAs(UnmanagedType.Bool)] out bool muted);
    }
  }
}
