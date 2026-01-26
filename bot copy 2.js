// bot.js - الإصدار المحسّن

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');

// استيراد الوحدات التي قمنا بإنشائها
const config = require('./config');
const state = require('./state');
const db = require('./database');
const { handleStatefulMessage } = require('./state-handler');
const eventHandlers = require('./event-handler');

// استيراد معالجات الأوامر
const aiCommands = require('./commands/ai-commands');
const adminCommands = require('./commands/admin-commands');
const setupCommands = require('./commands/setup-handler');
const managementCommands = require('./commands/management-handler');
const courseCommands = require('./commands/course-management');
const addLectureCommands = require('./commands/add-lecture-commands');
const downloadCommands = require('./commands/download-commands');

// دمج جميع الأوامر في خريطة واحدة لتسهيل الوصول إليها
const commands = {
    ...aiCommands,
    ...adminCommands,
    ...setupCommands,
    ...managementCommands,
    ...courseCommands,
    ...addLectureCommands,
    ...downloadCommands,
};

// تحديد مسار Chrome (قد تحتاج لتعديله)
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

console.log('[🚀] Initializing WhatsApp client...');
const client = new Client({ 
    authStrategy: new LocalAuth({ 
        clientId: "whatsapp-bot",
        dataPath: path.join(__dirname, '.wwebjs_auth')
    }),
    puppeteer: {
        headless: "new", // استخدام الوضع الجديد
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-infobars',
            '--disable-notifications',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--enable-unsafe-swiftshader',
            '--disable-web-security',
            '--aggressive-cache-discard',
            '--max-old-space-size=256', // زيادة الذاكرة
        ],
        executablePath: chromePath,
        timeout: 120000, // زيادة المهلة إلى 120 ثانية
        slowMo: 100,
        ignoreHTTPSErrors: true
    }
});

// معالجة أخطاء Puppeteer
client.on('auth_failure', msg => {
    console.error('[❌] Authentication failure:', msg);
    state.isBotReady = false;
    process.exit(1);
});

client.on('disconnected', reason => {
    console.log('[❌] Client was logged out:', reason);
    state.isBotReady = false;
});

client.on('qr', qr => {
    console.log('[📸] Scan the QR code below:');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('[✅] Authenticated successfully!');
});

client.on('ready', async () => {
    state.isBotReady = true;
    console.log('[✅] Client is ready!');
    
    try {
        // تحميل بيانات المجموعات
        const chats = await client.getChats();
        chats.forEach(chat => {
            if (chat.isGroup) {
                state.groupsMetadata.set(chat.id._serialized, chat.name);
            }
        });
        console.log(`[ℹ️] Loaded metadata for ${state.groupsMetadata.size} groups.`);

        // إرسال رسالة للمالك بأن البوت يعمل
        if (config.OWNER_ID) {
            await client.sendMessage(config.OWNER_ID, `✅ *البوت يعمل الآن بالهيكل الجديد وجاهز لاستقبال الأوامر*${config.SIGNATURE}`);
        }
    } catch (error) {
        console.error('[❌] Error in ready event:', error);
    }
});

// --- Event Handlers from event-handler.js ---
client.on('group_join', (notification) => {
    try {
        eventHandlers.handleGroupJoin(notification, client);
    } catch (error) {
        console.error('[❌] Error in group_join event:', error);
    }
});

client.on('group_leave', (notification) => {
    try {
        eventHandlers.handleGroupLeave(notification, client);
    } catch (error) {
        console.error('[❌] Error in group_leave event:', error);
    }
});

client.on('group_admin_changed', (notification) => {
    try {
        eventHandlers.handleGroupAdminChanged(notification, client);
    } catch (error) {
        console.error('[❌] Error in group_admin_changed event:', error);
    }
});

// ---------------------------------------------------
// MAIN MESSAGE ROUTER
// ---------------------------------------------------

client.on('message_create', async message => {
    // الشرط المحدث لمنع معالجة رسائل البوت الخاصة وحالات الواتساب
    if (message.fromMe || !state.isBotReady || !message.body || message.from === 'status@broadcast') {
        return;
    }

    try {
        // الخطوة 1: التحقق من وجود حالة نشطة للمستخدم (مثل عملية الإعداد)
        const wasHandledByState = await handleStatefulMessage(message, client);
        if (wasHandledByState) {
            return; 
        }

        // الخطوة 2: إذا لم تكن هناك حالة، تحقق مما إذا كانت الرسالة أمرًا
        const command = message.body.split(' ')[0].toLowerCase();
        const commandHandler = commands[command];

        if (commandHandler) {
            console.log(`[CMD] Executing command "${command}" for ${message.from}`);
            await commandHandler(message, client);
        }
    } catch (error) {
        console.error('[❌] An error occurred in message_create handler:', error);
        try {
            await message.reply(`⚠️ حدث خطأ غير متوقع: ${error.message}${config.SIGNATURE}`);
        } catch (replyError) {
            console.error('[❌] Error sending error message:', replyError);
        }
    }
});

/**
 * @description دالة رئيسية لبدء تشغيل البوت.
 */
async function start() {
    console.log('[🔄] Initializing database with the new structure...');
    try {
        db.initializeDatabase();
    } catch (error) {
        console.error('[❌] Error initializing database:', error);
        process.exit(1);
    }

    // في الهيكل الجديد، يتم إدخال بيانات الشعب عبر أمر الإعداد،
    // لكننا ما زلنا نحتاج لتحميل قائمة المبرمجين عند بدء التشغيل.
    console.log('[📂] Loading initial data (developers)...');
    try {
        const data = await db.loadAllData();
        state.admins = new Set((data.developers || []).map(dev => dev.userId));
        console.log(`[📊] Loaded ${state.admins.size} developers/admins.`);

    } catch (error) {
        console.warn('[⚠️] Could not load developers list, this might be the first run.', error);
    }
    
    // تحميل بيانات المقررات
    console.log('[📂] Loading courses data...');
    try {
        const coursesData = await db.loadCoursesData();
        state.sections = coursesData.sections;
        state.classes = coursesData.classes;
        state.subjects = coursesData.subjects;
        state.groupsData = coursesData.groups;
        state.professors = coursesData.professors;
        
        console.log(`[📊] Loaded ${state.sections.size} sections, ${state.classes.size} classes, ${state.subjects.size} subjects, ${state.groupsData.size} groups, and ${state.professors.size} professors.`);
    } catch (error) {
        console.warn('[⚠️] Could not load courses data, this might be the first run.', error);
    }

    console.log('[▶️] Starting client initialization...');
    try {
        await client.initialize();
    } catch (error) {
        console.error('[❌] Error initializing client:', error);
        process.exit(1);
    }
}

// ---------------------------------------------------
// START THE BOT
// ---------------------------------------------------

// معالجة الأخطاء غير الملتقطة
process.on('uncaughtException', (error) => {
    console.error('[❌] Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[❌] Unhandled Rejection at:', promise, 'reason:', reason);
});

// بدء البوت
start();