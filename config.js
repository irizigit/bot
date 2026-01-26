// config.js
const { SIGNATURE, OWNER_ID, DEBUG_MODE, DATABASE_URL, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, AI_API_KEY, USER_STATE_TIMEOUT, FONTS_DIR } = process.env;

module.exports = {
    // إعدادات البوت الأساسية
    BOT_NAME: 'بوت المطور',
    VERSION: '1.0.0',
    SIGNATURE: '\n\n🤖 بواسطة بوت المطور',
    
    // معرف المالك (يجب تغييره إلى معرفك الشخصي)
    OWNER_ID: '212621957775@c.us',
    
    // إعدادات قاعدة البيانات (Supabase)
    SUPABASE_URL: process.env.SUPABASE_URL || 'https://your-project.supabase.co',
    SUPABASE_KEY: process.env.SUPABASE_KEY || 'your-supabase-key',
    
    // إعدادات الذكاء الاصطناعي (OpenAI)
    AI_API_KEY: process.env.AI_API_KEY || 'YOUR_AI_API_KEY',
    GITHUB_TOKEN,
    GITHUB_OWNER,
    GITHUB_REPO,
    // إعدادات الجلسات
    USER_STATE_TIMEOUT: 300000, // 5 دقائق
    
    // إعدادات البوت
    AUTO_RESTART: true,
    DEBUG_MODE: process.env.DEBUG_MODE === 'true',
    
    // رسائل البوت
    MESSAGES: {
        WELCOME: 'مرحباً بك في بوت واتساب لإدارة المحاضرات!',
        ERROR: 'حدث خطأ، يرجى المحاولة مرة أخرى لاحقاً.',
        PERMISSION_DENIED: '⚠️ ليس لديك صلاحية لاستخدام هذا الأمر!',
        GROUP_ONLY: '⚠️ هذا الأمر يعمل في المجموعات فقط!',
        CANCELLED: '✅ تم إلغاء العملية.',
        TIMEOUT: '⏱️ انتهت صلاحية الجلسة. يرجى البدء من جديد.',
        INVALID_OPTION: '⚠️ خيار غير صالح. يرجى المحاولة مرة أخرى.',
        SUCCESS: '✅ تمت العملية بنجاح.',
        FAILED: '⚠️ فشلت العملية. يرجى المحاولة مرة أخرى.',
    }
};