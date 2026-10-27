using System;
using System.Runtime.InteropServices;

namespace MeuKeymap {
 [ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IDevices { int EnumAudioEndpoints(int flow,int mask,out IntPtr devices); [PreserveSig]int GetDefaultAudioEndpoint(int flow,int role,out IDevice device); }
 [ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IDevice { [PreserveSig]int Activate(ref Guid iid,int context,IntPtr parameters,[MarshalAs(UnmanagedType.IUnknown)]out object instance); int OpenPropertyStore(int access,out IntPtr store); int GetId([MarshalAs(UnmanagedType.LPWStr)]out string id); }
 [ComImport,Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IMeter { [PreserveSig]int GetPeakValue(out float value); }
 [ComImport,Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IVolume {
  int RegisterControlChangeNotify(IntPtr p); int UnregisterControlChangeNotify(IntPtr p); int GetChannelCount(out uint count);
  int SetMasterVolumeLevel(float value,Guid context); int SetMasterVolumeLevelScalar(float value,Guid context);
  int GetMasterVolumeLevel(out float value); [PreserveSig]int GetMasterVolumeLevelScalar(out float value);
  int SetChannelVolumeLevel(uint channel,float value,Guid context); int SetChannelVolumeLevelScalar(uint channel,float value,Guid context);
  int GetChannelVolumeLevel(uint channel,out float value); int GetChannelVolumeLevelScalar(uint channel,out float value);
  int SetMute([MarshalAs(UnmanagedType.Bool)]bool value,Guid context); [PreserveSig]int GetMute([MarshalAs(UnmanagedType.Bool)]out bool value);
 }
 public sealed class AudioReadOnly:IDisposable {
  IDevices devices; IDevice device; IMeter meter; IVolume volume; string currentId;
  public AudioReadOnly(){devices=(IDevices)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));}
  void ReleaseDevice(){if(meter!=null)Marshal.ReleaseComObject(meter);if(volume!=null)Marshal.ReleaseComObject(volume);if(device!=null)Marshal.ReleaseComObject(device);meter=null;volume=null;device=null;currentId=null;}
  void Refresh(){IDevice next;Marshal.ThrowExceptionForHR(devices.GetDefaultAudioEndpoint(1,1,out next));string id;next.GetId(out id);if(id==currentId){Marshal.ReleaseComObject(next);return;}ReleaseDevice();device=next;currentId=id;object instance;Guid meterId=new Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064");Marshal.ThrowExceptionForHR(device.Activate(ref meterId,23,IntPtr.Zero,out instance));meter=(IMeter)instance;Guid volumeId=new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");Marshal.ThrowExceptionForHR(device.Activate(ref volumeId,23,IntPtr.Zero,out instance));volume=(IVolume)instance;}
  public double[] Read(){try{Refresh();float peak,gain;bool muted;Marshal.ThrowExceptionForHR(meter.GetPeakValue(out peak));Marshal.ThrowExceptionForHR(volume.GetMasterVolumeLevelScalar(out gain));Marshal.ThrowExceptionForHR(volume.GetMute(out muted));return new double[]{Math.Max(0,Math.Min(100,peak*100)),gain*100,muted?1:0};}catch{ReleaseDevice();throw;}}
  public void Dispose(){ReleaseDevice();if(devices!=null)Marshal.ReleaseComObject(devices);devices=null;}
 }
}
