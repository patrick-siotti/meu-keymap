param([Parameter(Mandatory=$true)][string]$Source)
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$batches=[Console]::In.ReadToEnd()|ConvertFrom-Json
$code=[IO.File]::ReadAllText($Source)
$send='[DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,Input[] inputs,int size);'
$state='[DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);'
if(!$code.Contains($send) -or !$code.Contains($state)){throw 'P/Invoke seam changed; refusing native test execution.'}
$code=$code.Replace($send,'static uint SendInput(uint count,Input[] inputs,int size){return Capture(count,inputs,size);}')
$code=$code.Replace($state,'static short GetAsyncKeyState(int key){return heldKeys.Contains(key)?unchecked((short)0x8000):(short)0;}')
$playbackSource=[IO.File]::ReadAllText((Join-Path (Split-Path -Parent $Source) 'PlaybackMute.cs'))
$code=$code+[Environment]::NewLine+($playbackSource -replace '(?m)^using [^;]+;\r?\n','')
# Fail closed: the compiled test copy must contain no native import or extern method.
if($code -match 'DllImport|\bextern\b'){throw 'Native import remained; refusing to compile.'}
$seam=@'
    static HashSet<int> heldKeys=new HashSet<int>();
    static List<object> captured=new List<object>();
    static bool partialSend;
    static uint Capture(uint count,Input[] inputs,int size){
      var values=new List<object>();
      foreach(var value in inputs){
        IntPtr memory=Marshal.AllocHGlobal(size);
        try{
          for(int i=0;i<size;i++)Marshal.WriteByte(memory,i,0);
          Marshal.StructureToPtr(value,memory,false);
          var bytes=new byte[size];Marshal.Copy(memory,bytes,0,size);
          values.Add(new {type=value.type,key=value.data.keyboard.key,scan=value.data.keyboard.scan,flags=value.data.keyboard.flags,time=value.data.keyboard.time,extra=value.data.keyboard.extra.ToUInt64(),hex=BitConverter.ToString(bytes).Replace("-","")});
        }finally{Marshal.FreeHGlobal(memory);}
      }
      captured.Add(new {count=count,size=size,inputs=values});
      if(partialSend){partialSend=false;return count-1;}return count;
    }
    sealed class FakeOutput : PlaybackMute.Output {
      readonly int index;
      readonly List<object> changes;
      bool muted;
      public FakeOutput(int index,bool muted,List<object> changes){this.index=index;this.muted=muted;this.changes=changes;}
      public bool Muted {
        get {return muted;}
        set {muted=value;changes.Add(new {index=index,muted=muted});}
      }
      public void Dispose(){}
    }
    public static string Dry(string requests,int[] held,bool partial,bool[] sound){
      heldKeys=new HashSet<int>(held);captured=new List<object>();partialSend=partial;
      var input=Console.In;var output=Console.Out;var log=new System.IO.StringWriter();
      var muteChanges=new List<object>();
      var outputs=new List<PlaybackMute.Output>();
      for(int index=0;index<sound.Length;index++)outputs.Add(new FakeOutput(index,sound[index],muteChanges));
      try{Console.SetIn(new System.IO.StringReader(requests));Console.SetOut(log);Run(new PlaybackMute(()=>outputs));}
      finally{Console.SetIn(input);Console.SetOut(output);}
      return new JavaScriptSerializer().Serialize(new {pointerBytes=IntPtr.Size,inputBytes=Marshal.SizeOf(typeof(Input)),unionOffset=Marshal.OffsetOf(typeof(Input),"data").ToInt32(),keyboardBytes=Marshal.SizeOf(typeof(Keyboard)),extraOffset=Marshal.OffsetOf(typeof(Keyboard),"extra").ToInt32(),calls=captured,reply=log.ToString(),muteChanges=muteChanges});
    }
'@
$code=$code.Replace('public static void Run(){',$seam+[Environment]::NewLine+'public static void Run(){')
$code=$code.Replace('public static class ActionHost','public static class ActionHostDry')
Add-Type -TypeDefinition $code -ReferencedAssemblies @('System.Web.Extensions')
$results=@(foreach($batch in $batches){$requests=(@($batch.requests)|ForEach-Object {$_|ConvertTo-Json -Depth 12 -Compress}) -join [Environment]::NewLine; [MeuKeymap.ActionHostDry]::Dry($requests,[int[]]@($batch.held),[bool]$batch.partial,[bool[]]@($batch.sound | Where-Object {$_ -ne $null}))|ConvertFrom-Json})
ConvertTo-Json -InputObject $results -Depth 20 -Compress
