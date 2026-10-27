using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace MeuKeymap {
  // Fixed reads, bounded bindings and FE B0 RGB. No firmware/reset/FC commands.
  public static class DeviceConfiguration {
    [StructLayout(LayoutKind.Sequential)] struct Attributes { public int size; public ushort vendor,product,version; }
    [StructLayout(LayoutKind.Sequential)] struct Overlap { public IntPtr internalLow,internalHigh; public uint offset,offsetHigh; public IntPtr signal; }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool ReadFile(SafeFileHandle file,IntPtr data,uint size,out uint read,IntPtr overlap);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool WriteFile(SafeFileHandle file,IntPtr data,uint size,out uint written,IntPtr overlap);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetOverlappedResult(SafeFileHandle file,IntPtr overlap,out uint size,bool wait);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool CancelIoEx(SafeFileHandle file,IntPtr overlap);
    [DllImport("hid.dll")] static extern bool HidD_GetAttributes(SafeFileHandle file,ref Attributes attributes);
    public sealed class LayerRead { public int layer; public List<string> reports=new List<string>(); }
    public sealed class Snapshot { public long at; public string devicePath; public string identity; public List<LayerRead> layers=new List<LayerRead>(); public string error; }
    public sealed class LightRead { public int layer; public string raw; }
    public sealed class LightSnapshot { public long at; public string devicePath; public string identity; public List<LightRead> layers=new List<LightRead>(); }
    static byte[] Io(SafeFileHandle file,byte[] bytes,bool write,int timeout) {
      using(var signal=new EventWaitHandle(false,EventResetMode.ManualReset)) {
        var pinned=GCHandle.Alloc(bytes,GCHandleType.Pinned);
        IntPtr overlap=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Overlap)));
        bool pending=false;
        try {
          Marshal.StructureToPtr(new Overlap {signal=signal.SafeWaitHandle.DangerousGetHandle()},overlap,false);
          uint count;
          bool ok=write?WriteFile(file,pinned.AddrOfPinnedObject(),(uint)bytes.Length,out count,overlap):ReadFile(file,pinned.AddrOfPinnedObject(),(uint)bytes.Length,out count,overlap);
          if(!ok) {
            int code=Marshal.GetLastWin32Error();
            if(code!=997)throw new InvalidOperationException("Falha de transporte HID: "+code);
            pending=true;
            if(!signal.WaitOne(timeout)) {
              CancelIoEx(file,overlap);
              GetOverlappedResult(file,overlap,out count,true);pending=false;
              if(write)throw new TimeoutException("Tempo excedido na consulta HID.");
              return null;
            }
            if(!GetOverlappedResult(file,overlap,out count,false)) {pending=false;throw new InvalidOperationException("Falha ao concluir leitura HID: "+Marshal.GetLastWin32Error());}
            pending=false;
          }
          if(write && count!=65)throw new InvalidOperationException("Consulta HID incompleta.");
          var result=new byte[count];Array.Copy(bytes,result,count);return result;
        } finally {
          if(pending){uint ignored;CancelIoEx(file,overlap);GetOverlappedResult(file,overlap,out ignored,true);}
          Marshal.FreeHGlobal(overlap);pinned.Free();
        }
      }
    }
    static string Hex(byte[] value) {return value==null?null:BitConverter.ToString(value).Replace("-","");}
    static void Query(SafeFileHandle file,byte command,byte layer) {
      var bytes=new byte[65];bytes[0]=3;bytes[1]=command;
      if(command==0xFB){bytes[2]=0xFB;bytes[3]=0xFB;}
      else if(command==0xFA && layer>=1 && layer<=3){bytes[2]=25;bytes[3]=0;bytes[4]=layer;}
      else throw new InvalidOperationException("Consulta fora da lista permitida.");
      Io(file,bytes,true,700);
    }
    public static int WriteBindings(string[] packets) {
      return WriteBindings(packets,null);
    }
    public static int WriteBindings(string[] packets,string expectedPath) {
      if(packets==null||packets.Length>75)throw new InvalidOperationException("Quantidade de bindings invalida.");
      var validated=new List<byte[]>();var addresses=new HashSet<string>();
      foreach(string hex in packets){
        if(hex==null||hex.Length!=130)throw new InvalidOperationException("Relatorio deve ter 65 bytes.");
        var packet=new byte[65];for(int i=0;i<65;i++)packet[i]=Convert.ToByte(hex.Substring(i*2,2),16);
        if(packet[0]!=3||packet[1]!=0xFD||packet[2]<1||packet[2]>25||packet[3]<1||packet[3]>3||packet[4]<1||packet[4]>3)throw new InvalidOperationException("Binding fora do escopo permitido.");
        if(packet[4]==1&&packet[6]>18)throw new InvalidOperationException("Macro excede 18 entradas.");
        if(!addresses.Add(packet[3]+":"+packet[2]))throw new InvalidOperationException("Binding duplicado.");
        validated.Add(packet);
      }
      var candidates=new List<DeviceCollection>();
      foreach(var item in DeviceInput.Enumerate())if(item.usagePage==0xFF00&&item.usage==1&&item.inputBytes==65&&item.outputBytes==65)candidates.Add(item);
      if(candidates.Count!=1)throw new InvalidOperationException("Conecte exatamente um macropad compativel.");
      if(!String.IsNullOrEmpty(expectedPath)&&!String.Equals(candidates[0].path,expectedPath,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Identidade mudou antes da escrita; envio cancelado.");
      using(var file=CreateFile(candidates[0].path,0xC0000000,3,IntPtr.Zero,3,0x40000000,IntPtr.Zero)){
        var attributes=new Attributes {size=Marshal.SizeOf(typeof(Attributes))};
        if(file.IsInvalid||!HidD_GetAttributes(file,ref attributes)||attributes.vendor!=0x514C||attributes.product!=0x8850)throw new InvalidOperationException("Identidade HID divergente.");
        Query(file,0xFB,0);var identity=Io(file,new byte[65],false,900);
        if(identity==null||identity.Length!=65||identity[0]!=3||identity[1]!=0xFB||identity[2]!=16||identity[3]!=3||identity[4]!=11)throw new InvalidOperationException("Gravacao liberada somente para 16+3, versao 11 confirmada.");
        foreach(var packet in validated){
          Io(file,packet,true,700);Thread.Sleep(50);
          var commit=new byte[65];commit[0]=3;commit[1]=0xFD;commit[2]=0xFE;commit[3]=0xFF;
          Io(file,commit,true,700);Thread.Sleep(80);
        }
      }
      return validated.Count;
    }
    public static Snapshot Read() {
      var candidates=new List<DeviceCollection>();
      foreach(var item in DeviceInput.Enumerate())if(item.usagePage==0xFF00&&item.usage==1&&item.inputBytes==65&&item.outputBytes==65)candidates.Add(item);
      if(candidates.Count!=1)throw new InvalidOperationException("E necessario exatamente um macropad compativel conectado.");
      string path=candidates[0].path;
      if(!DeviceInput.IsTarget(path))throw new InvalidOperationException("Aparelho fora do escopo.");
      using(var file=CreateFile(path,0xC0000000,3,IntPtr.Zero,3,0x40000000,IntPtr.Zero)) {
        if(file.IsInvalid)throw new InvalidOperationException("Nao foi possivel abrir o canal de configuracao: "+Marshal.GetLastWin32Error());
        var attributes=new Attributes {size=Marshal.SizeOf(typeof(Attributes))};
        if(!HidD_GetAttributes(file,ref attributes)||attributes.vendor!=0x514C||attributes.product!=0x8850)throw new InvalidOperationException("Identidade HID divergente.");
        var snapshot=new Snapshot {at=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),devicePath=path};
        Query(file,0xFB,0);
        byte[] identity=Io(file,new byte[65],false,900);
        snapshot.identity=Hex(identity);
        if(identity==null||identity.Length<5||identity[0]!=3||identity[1]!=0xFB){snapshot.error="Identificacao FB ausente ou desconhecida; leitura FA nao enviada.";return snapshot;}
        if(identity[2]!=16||identity[3]!=3||identity[4]<=9){snapshot.error="O aparelho nao confirmou o formato de leitura 16+3 desta ferramenta; nenhuma outra consulta enviada.";return snapshot;}
        for(byte layer=1;layer<=3;layer++) {
          var bank=new LayerRead {layer=layer};snapshot.layers.Add(bank);
          Query(file,0xFA,layer);
          for(int i=0;i<25;i++) {
            var packet=Io(file,new byte[65],false,700);
            if(packet==null){snapshot.error="Leitura incompleta na camada "+layer;return snapshot;}
            bank.reports.Add(Hex(packet));
          }
        }
        return snapshot;
      }
    }
    // Original 0x40dea0/0x40e550: FA B0, zero-based layer, followed by one read.
    // This is a separate fixed query, never the FC configuration/firmware path.
    public static LightSnapshot ReadLights() {
      var candidates=new List<DeviceCollection>();
      foreach(var item in DeviceInput.Enumerate())if(item.usagePage==0xFF00&&item.usage==1&&item.inputBytes==65&&item.outputBytes==65)candidates.Add(item);
      if(candidates.Count!=1)throw new InvalidOperationException("Conecte exatamente um macropad compativel.");
      using(var file=CreateFile(candidates[0].path,0xC0000000,3,IntPtr.Zero,3,0x40000000,IntPtr.Zero)){
        var attributes=new Attributes {size=Marshal.SizeOf(typeof(Attributes))};
        if(file.IsInvalid||!HidD_GetAttributes(file,ref attributes)||attributes.vendor!=0x514C||attributes.product!=0x8850)throw new InvalidOperationException("Identidade HID divergente.");
        Query(file,0xFB,0);var identity=Io(file,new byte[65],false,900);
        if(identity==null||identity.Length!=65||identity[0]!=3||identity[1]!=0xFB||identity[2]!=16||identity[3]!=3||identity[4]!=11)throw new InvalidOperationException("RGB disponivel somente para 16+3/v11 confirmado.");
        var snapshot=new LightSnapshot {at=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),devicePath=candidates[0].path,identity=Hex(identity)};
        for(byte layer=0;layer<3;layer++){
          var query=new byte[65];query[0]=3;query[1]=0xFA;query[2]=0xB0;query[3]=layer;
          Io(file,query,true,700);
          var reply=Io(file,new byte[65],false,1000);
          if(reply==null)throw new TimeoutException("Sem resposta RGB na camada "+(layer+1));
          snapshot.layers.Add(new LightRead {layer=layer,raw=Hex(reply)});
        }
        return snapshot;
      }
    }
    public static int WriteLights(string hex) {
      return WriteLightPackets(new string[]{hex});
    }
    public static int WriteLightsBatch(string[] hex) {
      if(hex==null||hex.Length<1||hex.Length>3)throw new InvalidOperationException("RGB exige de uma a tres camadas completas.");
      return WriteLightPackets(hex);
    }
    public static int WriteLightsBatch(string[] hex,string expectedPath) {
      if(hex==null||hex.Length<1||hex.Length>3)throw new InvalidOperationException("RGB exige de uma a tres camadas completas.");
      return WriteLightPackets(hex,expectedPath);
    }
    static int WriteLightPackets(string[] hexPackets,string expectedPath=null) {
      var packets=new List<byte[]>();var layers=new HashSet<int>();
      foreach(string hex in hexPackets){
        if(hex==null||hex.Length!=130)throw new InvalidOperationException("RGB deve ter 65 bytes.");
        var packet=new byte[65];for(int i=0;i<65;i++)packet[i]=Convert.ToByte(hex.Substring(i*2,2),16);
        if(packet[0]!=3||packet[1]!=0xFE||packet[2]!=0xB0||packet[3]>2||packet[4]>5||!layers.Add(packet[3]))throw new InvalidOperationException("Pacote RGB fora do escopo.");
        for(int i=53;i<65;i++)if(packet[i]!=0)throw new InvalidOperationException("Reserva RGB deve estar zerada.");
        packets.Add(packet);
      }
      var candidates=new List<DeviceCollection>();
      foreach(var item in DeviceInput.Enumerate())if(item.usagePage==0xFF00&&item.usage==1&&item.inputBytes==65&&item.outputBytes==65)candidates.Add(item);
      if(candidates.Count!=1)throw new InvalidOperationException("Conecte exatamente um macropad compativel.");
      if(!String.IsNullOrEmpty(expectedPath)&&!String.Equals(candidates[0].path,expectedPath,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Identidade mudou antes da escrita RGB; envio cancelado.");
      using(var file=CreateFile(candidates[0].path,0xC0000000,3,IntPtr.Zero,3,0x40000000,IntPtr.Zero)){
        var attributes=new Attributes {size=Marshal.SizeOf(typeof(Attributes))};
        if(file.IsInvalid||!HidD_GetAttributes(file,ref attributes)||attributes.vendor!=0x514C||attributes.product!=0x8850)throw new InvalidOperationException("Identidade HID divergente.");
        Query(file,0xFB,0);var identity=Io(file,new byte[65],false,900);
        if(identity==null||identity.Length!=65||identity[0]!=3||identity[1]!=0xFB||identity[2]!=16||identity[3]!=3||identity[4]!=11)throw new InvalidOperationException("RGB disponivel somente para 16+3/v11 confirmado.");
        foreach(var packet in packets){Io(file,packet,true,700);Thread.Sleep(120);}
      }
      return packets.Count;
    }
  }
}
