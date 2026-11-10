/** Computes a stable content hash for one normalized YouTube video. */
export default function(_ctx:Context,_session:Session|null,opts:{
 /** YouTube video ID. */ id:string;
 /** Video title. */ title:string;
 /** Video description. */ description?:string;
 /** ISO publication timestamp. */ publishedAt?:string;
 /** Transcript text when available. */ transcript?:string;
}):string{return String(Bun.hash(JSON.stringify([opts.id,opts.title,opts.description??"",opts.publishedAt??"",opts.transcript??""])));}
