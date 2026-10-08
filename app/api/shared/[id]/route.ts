import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/admin";
import { removeSharedChatFiles, sharedChatFiles } from "@/lib/shared-chat-files";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Owner deletes a Shared plan. The delete_shared_plan RPC cascades every row; the chat files in storage are
// removed here first because only the service client can delete other members' uploads.
export async function DELETE(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  if(req.headers.get("origin")!==new URL(req.url).origin||req.headers.get("X-Zest-Action")!=="delete-shared-plan")
    return NextResponse.json({error:"Invalid request"},{status:403});
  const {id}=await params;
  if(!ID.test(id))return NextResponse.json({error:"delete_not_allowed"},{status:404});
  const db=await createClient();
  const {data:{user}}=await db.auth.getUser();
  if(!user)return NextResponse.json({error:"authentication_required"},{status:401});
  const {data:plan}=await db.from("shared_plans").select("owner_id").eq("id",id).maybeSingle();
  if(!plan||plan.owner_id!==user.id)return NextResponse.json({error:"delete_not_allowed"},{status:403});
  try{
    const admin=serviceClient();
    await removeSharedChatFiles(admin,await sharedChatFiles(admin,id));
  }catch{
    return NextResponse.json({error:"Could not delete this group."},{status:503});
  }
  const {error}=await db.rpc("delete_shared_plan",{p_plan:id});
  if(error)return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json({ok:true},{headers:{"Cache-Control":"no-store"}});
}
