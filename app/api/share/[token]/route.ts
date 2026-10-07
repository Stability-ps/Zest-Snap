import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sharedErrorMessage } from "@/lib/shared-errors";

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_:NextRequest,{params}:{params:Promise<{token:string}>}){
  const {token}=await params;
  if(!TOKEN.test(token))return NextResponse.json({error:"invite_unavailable"},{status:404});
  const db=await createClient();
  const {data,error}=await db.rpc("shared_invite_preview",{p_token:token});
  if(error||!data?.length)return NextResponse.json({error:"invite_unavailable"},{status:404});
  return NextResponse.json({invite:data[0]},{headers:{"Cache-Control":"private, no-store"}});
}

export async function POST(_:NextRequest,{params}:{params:Promise<{token:string}>}){
  const {token}=await params;
  if(!TOKEN.test(token))return NextResponse.json({error:sharedErrorMessage("invite_unavailable","")},{status:404});
  const db=await createClient();
  const {data:{user}}=await db.auth.getUser();
  if(!user)return NextResponse.json({error:"sign_in_required"},{status:401});
  const {data,error}=await db.rpc("accept_shared_invite",{p_token:token});
  if(error)return NextResponse.json({error:sharedErrorMessage(error,"Could not accept this invitation.")},{status:400});
  return NextResponse.json({ok:true,planId:data});
}
