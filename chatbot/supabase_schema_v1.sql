-- =========================================================
-- Supabase schema v1 — עוזר וירטואלי בוואטסאפ (ויקי כץ)
-- =========================================================
-- 4 טבלאות: conversations, messages, leads, message_log (rate-limiting)
-- + 2 Views לשימוש נוח בעורך הטבלאות של Supabase (משמש כדשבורד)
-- SQL נכתב בכוונה (Views + query rate-limiting) — ראו סיכום התכנון.

-- ---------------------------------------------------------
-- 1. conversations — שיחה אחת = מספר טלפון + חלון זמן
-- ---------------------------------------------------------
create table conversations (
    id            uuid primary key default gen_random_uuid(),
    phone_number  text not null,
    branch        text check (branch in ('recruiter', 'client', 'curious', 'unclassified')) default 'unclassified',
    status        text check (status in ('active', 'closed')) default 'active',
    started_at    timestamptz not null default now(),
    ended_at      timestamptz,
    message_count int not null default 0
);

create index idx_conversations_phone on conversations (phone_number);
create index idx_conversations_status on conversations (status);

-- הגנה נוספת: שיחת בוט אחת ליום למספר טלפון (הוחלט 26.7.2026).
-- לא אכיפה ברמת DB (כדי לא לחסום המשך שיחה אנושית ידנית של ויקי באותו
-- thread) - אלא בדיקה בלוגיקת השרת לפני פתיחת שיחה אוטומטית חדשה:
--
-- select 1 from conversations
-- where phone_number = $1
--   and started_at::date = current_date
-- limit 1;
--
-- אם קיימת שורה - לא פותחים שיחת בוט נוספת היום לאותו מספר (אפשר להשיב
-- הודעה קצרה, או פשוט לא להגיב ולהשאיר את ההודעה ל-Inbox הידני).
-- אינה חוסמת פנייה אמיתית להמשך - רק מונעת הפעלה חוזרת של הבוט/Claude
-- על אותו מספר באותו יום (הגנה מפני הצפה בלי עלות מודל).

-- ---------------------------------------------------------
-- 2. messages — כל הודעה בכל שיחה (התמלול המלא)
-- ---------------------------------------------------------
create table messages (
    id              uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references conversations (id) on delete cascade,
    role            text check (role in ('user', 'assistant')) not null,
    content         text not null,
    created_at      timestamptz not null default now()
);

create index idx_messages_conversation on messages (conversation_id);
create index idx_messages_created_at on messages (created_at);

-- ---------------------------------------------------------
-- 3. leads — כרטיס ליד מתומצת, נוצר בסגירת שיחה רלוונטית
-- ---------------------------------------------------------
create table leads (
    id                uuid primary key default gen_random_uuid(),
    conversation_id   uuid not null unique references conversations (id) on delete cascade,
    branch            text check (branch in ('recruiter', 'client')) not null,
    summary           text not null,          -- תקציר קצר שנוצר ע"י המודל בסגירה
    contact_name      text,                    -- שם הפונה (ובענף מגייסת - גם שם החברה מוזכר בסיכום)
    contact_info      text,                    -- טלפון/מייל שנמסרו מרצון
    preferred_channel text,                    -- ערוץ מועדף להמשך
    email_sent        boolean not null default false,
    created_at        timestamptz not null default now()
);

create index idx_leads_branch on leads (branch);
create index idx_leads_email_sent on leads (email_sent);

-- ---------------------------------------------------------
-- 4. message_log — לוג גולמי לצורך rate-limiting לפי מספר טלפון
-- ---------------------------------------------------------
-- טבלה נפרדת ומינימלית (לא counter) כדי לאפשר ספירה בחלון זמן נגלל
-- (rolling window) באמצעות שאילתה, בהתאם להחלטה לשלב SQL בכוונה.
create table message_log (
    id           bigint generated always as identity primary key,
    phone_number text not null,
    created_at   timestamptz not null default now()
);

create index idx_message_log_phone_time on message_log (phone_number, created_at desc);

-- שאילתת rate-limiting: כמה הודעות הגיעו ממספר נתון ב-10 הדקות האחרונות
-- (הערך "10 minutes" ניתן לכיוונון; זו השאילתה שהשרת יריץ בכל הודעה נכנסת)
--
-- select count(*) as recent_messages
-- from message_log
-- where phone_number = $1
--   and created_at > now() - interval '10 minutes';

-- ---------------------------------------------------------
-- 5. token_usage_log — לוג טוקנים לכל קריאה ל-Claude (הן get_bot_reply
--    והן extract_lead), לצורך תקרת ההוצאה היומית הגלובלית
-- ---------------------------------------------------------
create table token_usage_log (
    id            bigint generated always as identity primary key,
    input_tokens  int not null,
    output_tokens int not null,
    total_tokens  int generated always as (input_tokens + output_tokens) stored,
    created_at    timestamptz not null default now()
);

create index idx_token_usage_created_at on token_usage_log (created_at);

-- שאילתת תקרת הוצאה יומית: סה"כ טוקנים שנוצלו מתחילת היום (UTC)
--
-- select coalesce(sum(total_tokens), 0) as tokens_today
-- from token_usage_log
-- where created_at >= date_trunc('day', now());

-- ---------------------------------------------------------
-- 6. suspicious_activity_log — הודעות שסומנו כניסיון prompt injection
--    ע"י ההיוריסטיקה ב-app/guardrails.py (שכבת הגנה טכנית נוספת, מעבר
--    לטיפול הפנימי-לדמות בענף 3 של system_prompt.md)
-- ---------------------------------------------------------
create table suspicious_activity_log (
    id              bigint generated always as identity primary key,
    phone_number    text not null,
    message_text    text not null,
    matched_pattern text not null,
    created_at      timestamptz not null default now()
);

create index idx_suspicious_activity_phone_time on suspicious_activity_log (phone_number, created_at desc);

-- ---------------------------------------------------------
-- Views — לשימוש בעורך הטבלאות של Supabase כדשבורד
-- ---------------------------------------------------------

-- תצוגת לידים נוחה לקריאה, ממוינת מהחדש לישן
create view leads_dashboard as
select
    l.id,
    l.branch,
    l.summary,
    l.contact_name,
    l.contact_info,
    l.preferred_channel,
    l.email_sent,
    c.phone_number,
    c.started_at as conversation_started_at,
    c.ended_at   as conversation_ended_at,
    c.message_count,
    l.created_at as lead_created_at
from leads l
join conversations c on c.id = l.conversation_id
order by l.created_at desc;

-- תצוגת שימוש יומי גס למעקב אחר עומס/ניצול לרעה
create view daily_usage as
select
    date_trunc('day', created_at) as day,
    phone_number,
    count(*) as message_count
from message_log
group by 1, 2
order by 1 desc, 3 desc;

-- תצוגת צריכת טוקנים יומית, למעקב מול תקרת ההוצאה הגלובלית
create view daily_token_usage as
select
    date_trunc('day', created_at) as day,
    sum(input_tokens)  as input_tokens,
    sum(output_tokens) as output_tokens,
    sum(total_tokens)  as total_tokens
from token_usage_log
group by 1
order by 1 desc;

-- תצוגת פעילות חשודה (ניסיונות prompt injection), ממוינת מהחדש לישן
create view suspicious_activity_dashboard as
select
    phone_number,
    matched_pattern,
    message_text,
    created_at
from suspicious_activity_log
order by created_at desc;
