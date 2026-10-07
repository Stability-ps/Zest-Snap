"use client";

import { useCallback,useEffect,useMemo,useRef,useState } from "react";
import { CornerUpLeft,Edit3,Link2,MessageCircle,MoreHorizontal,Send,Smile,Trash2,X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import styles from "./shared-chat.module.css";

type Member={user_id:string;display_name:string;role:string};
type Item={id:string;title:string};
type Message={id:string;plan_id:string;sender_id:string;body:string;reply_to:string|null;item_id:string|null;edited_at:string|null;deleted_at:string|null;created_at:string};
type Reaction={message_id:string;user_id:string;emoji:string};
const QUICK=["👍","❤️","😂","🎉","👀"];

export default function SharedChat({planId,me,members,items}:{planId:string;me:string|null;members:Member[];items:Item[]}){
 const db=useMemo(()=>createClient(),[]);
 const [messages,setMessages]=useState<Message[]>([]),[reactions,setReactions]=useState<Reaction[]>([]);
 const [text,setText]=useState(""),[reply,setReply]=useState<Message|null>(null),[linkedItem,setLinkedItem]=useState<Item|null>(null);
 const [typing,setTyping]=useState<Record<string,string>>({}),[online,setOnline]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[emojiFor,setEmojiFor]=useState<string|null>(null);
 const endRef=useRef<HTMLDivElement|null>(null),typingTimer=useRef<number|null>(null),channelRef=useRef<ReturnType<typeof db.channel>|null>(null);
 const memberName=useCallback((id:string)=>members.find(m=>m.user_id===id)?.display_name||"Member",[members]);
 const load=useCallback(async()=>{
   const [m,r]=await Promise.all([
     db.from("shared_plan_messages").select("id,plan_id,sender_id,body,reply_to,item_id,edited_at,deleted_at,created_at").eq("plan_id",planId).order("created_at",{ascending:true}).limit(250),
     db.from("shared_plan_message_reactions").select("message_id,user_id,emoji").eq("plan_id",planId)
   ]);
   if(m.error){setError("Messages could not be loaded.");return;}
   setMessages((m.data||[]) as Message[]); setReactions((r.data||[]) as Reaction[]);
   await db.rpc("mark_shared_plan_read",{p_plan:planId});
 },[db,planId]);
 useEffect(()=>{load();},[load]);
 useEffect(()=>{endRef.current?.scrollIntoView({behavior:"smooth",block:"end"});},[messages.length]);
 useEffect(()=>{
   if(!me)return;
   const channel=db.channel(`shared-plan:${planId}`,{config:{private:true,presence:{key:me}}});
   channel
    .on("broadcast",{event:"message"},()=>load())
    .on("broadcast",{event:"reaction"},()=>load())
    .on("broadcast",{event:"typing"},({payload})=>{
      const p=payload as {user_id?:string;name?:string;typing?:boolean};
      const uid=p.user_id;if(!uid||uid===me)return;
      setTyping(v=>{const n={...v};if(p.typing)n[uid]=p.name||"Someone";else delete n[uid];return n;});
    })
    .on("presence",{event:"sync"},()=>{
      const state=channel.presenceState<{user_id?:string;name?:string}>();
      const next:Record<string,string>={};
      Object.values(state).flat().forEach(p=>{const uid=p.user_id;if(uid)next[uid]=p.name||memberName(uid);});
      setOnline(next);
    })
    .subscribe(async status=>{
      if(status==="SUBSCRIBED")await channel.track({user_id:me,name:memberName(me),online_at:new Date().toISOString()});
    });
   channelRef.current=channel;
   return()=>{channelRef.current=null;void db.removeChannel(channel);};
 },[db,me,memberName,planId,load]);
 const broadcast=async(event:string,payload:Record<string,unknown>)=>{await channelRef.current?.send({type:"broadcast",event,payload});};
 const sendTyping=(value:boolean)=>{
   if(!me)return;
   void broadcast("typing",{user_id:me,name:memberName(me),typing:value});
   if(typingTimer.current)window.clearTimeout(typingTimer.current);
   if(value)typingTimer.current=window.setTimeout(()=>void broadcast("typing",{user_id:me,name:memberName(me),typing:false}),1400);
 };
 async function send(){
   const body=text.trim();if(!me||!body||busy)return;
   setBusy(true);setError("");
   const {error:e}=await db.from("shared_plan_messages").insert({plan_id:planId,sender_id:me,body,reply_to:reply?.id||null,item_id:linkedItem?.id||null});
   if(e)setError("Message could not be sent.");
   else{setText("");setReply(null);setLinkedItem(null);sendTyping(false);await load();await broadcast("message",{plan_id:planId});}
   setBusy(false);
 }
 async function react(messageId:string,emoji:string){
   if(!me)return;
   const existing=reactions.find(r=>r.message_id===messageId&&r.user_id===me&&r.emoji===emoji);
   const q=existing?db.from("shared_plan_message_reactions").delete().eq("message_id",messageId).eq("user_id",me).eq("emoji",emoji)
     :db.from("shared_plan_message_reactions").insert({message_id:messageId,plan_id:planId,user_id:me,emoji});
   const {error:e}=await q;if(!e){setEmojiFor(null);await load();await broadcast("reaction",{plan_id:planId});}
 }
 async function edit(m:Message){
   if(m.sender_id!==me||m.deleted_at)return;
   const body=window.prompt("Edit message",m.body)?.trim();if(!body||body===m.body)return;
   const {error:e}=await db.rpc("edit_shared_message",{p_message:m.id,p_body:body});
   if(!e){await load();await broadcast("message",{plan_id:planId});}
 }
 async function remove(m:Message){
   if(m.sender_id!==me||m.deleted_at||!window.confirm("Delete this message?"))return;
   const {error:e}=await db.rpc("delete_shared_message",{p_message:m.id});
   if(!e){await load();await broadcast("message",{plan_id:planId});}
 }
 function replyMessage(id:string|null){return id?messages.find(m=>m.id===id)||null:null}
 function itemFor(id:string|null){return id?items.find(i=>i.id===id)||null:null}
 const typingNames=Object.values(typing),onlineCount=Object.keys(online).length;
 return <section className={styles.chatShell} aria-label="Plan messages">
   <div className={styles.chatTop}><div><strong>Messages</strong><small>Conversation stays with this plan</small></div><div className={styles.presence}><span className={styles.presenceDot}/>{onlineCount||1} online</div></div>
   <div className={styles.messages}>
    {!messages.length?<div className={styles.empty}><div><MessageCircle/><strong>Start the conversation</strong><span>Messages, replies and reactions stay connected to this plan.</span></div></div>:messages.map((m,idx)=>{
      const mine=m.sender_id===me,parent=replyMessage(m.reply_to),item=itemFor(m.item_id);
      const grouped=idx>0&&messages[idx-1].sender_id===m.sender_id&&(new Date(m.created_at).getTime()-new Date(messages[idx-1].created_at).getTime()<5*60_000);
      const rs=reactions.filter(r=>r.message_id===m.id);const groups=Object.entries(rs.reduce<Record<string,Reaction[]>>((a,r)=>((a[r.emoji]||=[]).push(r),a),{}));
      return <div className={`${styles.row} ${mine?styles.mine:styles.theirs}`} key={m.id}>
       {!mine&&!grouped&&<span className={styles.author}>{memberName(m.sender_id)}</span>}
       <div className={`${styles.bubble} ${m.deleted_at?styles.deleted:""}`}>
        {parent&&<div className={styles.replyPreview}><CornerUpLeft/><span><b>{memberName(parent.sender_id)}</b><br/>{parent.deleted_at?"Message deleted":parent.body.slice(0,90)}</span></div>}
        {item&&<div className={styles.itemPreview}><Link2/><span><b>Discussing</b><br/>{item.title}</span></div>}
        <div className={styles.body}>{m.body}</div>
        <div className={styles.meta}><span>{new Date(m.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}{m.edited_at?" · edited":""}</span>{!m.deleted_at&&<span className={styles.actions}><button onClick={()=>setReply(m)} aria-label="Reply"><CornerUpLeft/></button><button onClick={()=>setEmojiFor(emojiFor===m.id?null:m.id)} aria-label="React"><Smile/></button>{mine&&<><button onClick={()=>edit(m)} aria-label="Edit"><Edit3/></button><button onClick={()=>remove(m)} aria-label="Delete"><Trash2/></button></>}</span>}</div>
        {emojiFor===m.id&&<div className={styles.emojiTray}>{QUICK.map(e=><button key={e} onClick={()=>react(m.id,e)}>{e}</button>)}</div>}
        {!!groups.length&&<div className={styles.reactions}>{groups.map(([emoji,list])=><button key={emoji} className={`${styles.reaction} ${list.some(r=>r.user_id===me)?styles.reactionActive:""}`} onClick={()=>react(m.id,emoji)} title={list.map(r=>memberName(r.user_id)).join(", ")}>{emoji} {list.length}</button>)}</div>}
       </div>
      </div>
    })}<div ref={endRef}/>
   </div>
   <div className={styles.typing}>{typingNames.length?typingNames.slice(0,2).join(" & ")+" typing…":""}</div>
   <div className={styles.composer}>
    {(reply||linkedItem)&&<div className={styles.context}><span>{reply?`Replying to ${memberName(reply.sender_id)}`:`Discussing ${linkedItem?.title}`}</span><button onClick={()=>{setReply(null);setLinkedItem(null)}} aria-label="Clear context"><X/></button></div>}
    <div className={styles.composerRow}><textarea className={styles.input} rows={1} maxLength={4000} value={text} onChange={e=>{setText(e.target.value);sendTyping(!!e.target.value)}} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}} placeholder="Message the group…"/><button className={styles.send} disabled={busy||!text.trim()} onClick={send} aria-label="Send message"><Send/></button></div>
    {items.length>0&&!reply&&!linkedItem&&<button className={styles.actions} style={{opacity:1,marginTop:6}} onClick={()=>setLinkedItem(items[0])}><MoreHorizontal/> Discuss a plan item</button>}
    {error&&<small role="alert">{error}</small>}
   </div>
  </section>
}
