import { Copy,Clipboard,Scissors,Undo2,Redo2,Save,Search,ScanLine,FolderOpen,PanelsTopLeft,LockKeyhole,Keyboard,Type,ListOrdered,Terminal,Layers,Workflow,Plus,Volume2,VolumeX,Play,SkipForward,SkipBack,Star,Heart,Camera,Mail,Globe,Music,Calculator } from "lucide-react";
import type { ControlIcon } from "../../lib/control-icon";
import type { ActionIconName } from "../../lib/action-presentation";
interface ActionIconProps {name:ActionIconName;icon?:ControlIcon;size?:number;className?:string;}
const icons={copy:Copy,paste:Clipboard,cut:Scissors,undo:Undo2,redo:Redo2,save:Save,search:Search,capture:ScanLine,folder:FolderOpen,desktop:PanelsTopLeft,lock:LockKeyhole,keyboard:Keyboard,text:Type,macro:ListOrdered,command:Terminal,layer:Layers,event:Workflow,plus:Plus,volume:Volume2,mute:VolumeX,play:Play,next:SkipForward,previous:SkipBack,star:Star,heart:Heart,camera:Camera,mail:Mail,globe:Globe,music:Music,calculator:Calculator};
export function ActionIcon({name,icon,size=22,className}:ActionIconProps){
  if(icon?.kind==="image")return <img src={icon.dataUrl} width={size} height={size} className={className} alt="" aria-hidden="true" data-action-icon="image" style={{objectFit:"contain"}}/>;
  const selected=icon?.kind==="library"?icon.name:name,Icon=icons[selected]??Keyboard;
  return <Icon size={size} className={className} strokeWidth={1.6} aria-hidden="true" data-action-icon={selected}/>;
}
