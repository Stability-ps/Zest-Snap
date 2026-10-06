import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_:NextRequest,{params}:{params:Promise<{token:string}>}){
  const {token}=await params;
  const db=await createClient();
  const {data,error}=await db.rpc("shared_invite_preview",{p_token:token});
  if(error||!data?.length)return NextResponse.json({error:"invite_unavailable"},{status:404});
  return NextResponse.json({invite:data[0]},{headers:{"Cache-Control":"private, no-store"}});
}

export async function POST(_:NextRequest,{params}:{params:Promise<{token:string}>}){
  const {token}=await params;
  const db=await createClient();
  const {data:{user}}=await db.auth.getUser();
  if(!user)return NextResponse.json({error:"sign_in_required"},{status:401});
  const {data,error}=await db.rpc("accept_shared_invite",{p_token:token});
  if(error)return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json({ok:true,planId:data});
}
