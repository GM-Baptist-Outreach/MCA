import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://proiyioqfbjcmprsnqhf.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByb2l5aW9xZmJqY21wcnNucWhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMDY1MjMsImV4cCI6MjEwMTY4MjUyM30.yufhfBU7Wm9dOHuJz85-zuFd-8plw8YEGeV1NcG6dhA";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
