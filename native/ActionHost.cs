using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Diagnostics;
using System.Threading;
namespace MeuKeymap {
  public static class ActionHost {
    [StructLayout(LayoutKind.Sequential)] struct Mouse { public int x,y; public uint data,flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct Keyboard { public ushort key,scan; public uint flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct Union { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Keyboard keyboard; }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public Union data; }
    [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,Input[] inputs,int size);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    static Input Key(int code,bool up,bool unicode){bool extended=!unicode&&((code>=33&&code<=46)||code==91||code==92||code==163||code==165);return new Input {type=1,data=new Union {keyboard=new Keyboard {key=(ushort)(unicode?0:code),scan=(ushort)(unicode?code:0),flags=(uint)((up?2:0)|(unicode?4:0)|(extended?1:0))}}};}
    static void Send(List<Input> inputs){
      int size=Marshal.SizeOf(typeof(Input));
      if(SendInput((uint)inputs.Count,inputs.ToArray(),size)==(uint)inputs.Count)return;
      var releases=new List<Input>();foreach(var input in inputs)if((input.data.keyboard.flags&2)==0){var release=input;release.data.keyboard.flags|=2;releases.Add(release);}
      if(releases.Count>0)SendInput((uint)releases.Count,releases.ToArray(),size);
      throw new InvalidOperationException("SendInput nao completou a acao. Verifique foco e nivel de permissao da janela.");
    }
    public static void Run(){
      var json=new JavaScriptSerializer();Console.WriteLine("{\"ready\":true}");
      string line;
      while((line=Console.ReadLine())!=null){
        object id=null;
        try{
          var data=json.Deserialize<Dictionary<string,object>>(line);id=data["id"];
          var inputs=new List<Input>();string kind=(string)data["kind"];
          if(kind=="keys"){
            var keys=new List<object>();foreach(object item in (System.Collections.IEnumerable)data["keys"])keys.Add(item);if(keys.Count<1||keys.Count>9)throw new InvalidOperationException("Atalho invalido.");
            var pressed=new List<int>();
            foreach(object item in keys){int code=Convert.ToInt32(item);if(code<1||code>254)throw new InvalidOperationException("Codigo invalido.");if((GetAsyncKeyState(code)&0x8000)==0){inputs.Add(Key(code,false,false));pressed.Add(code);}}
            for(int i=pressed.Count-1;i>=0;i--)inputs.Add(Key(pressed[i],true,false));
          }else if(kind=="text"){
            string value=(string)data["text"];if(value.Length>2000)throw new InvalidOperationException("Texto muito longo.");
            foreach(char c in value){inputs.Add(Key(c,false,true));inputs.Add(Key(c,true,true));}
          }else throw new InvalidOperationException("Acao desconhecida.");
          if(inputs.Count>0)Send(inputs);
          Console.WriteLine(json.Serialize(new {id=id,ok=true}));
        }catch(Exception error){Console.WriteLine(json.Serialize(new {id=id,ok=false,error=error.Message}));}
      }
    }
  }
}
