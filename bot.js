require('dotenv').config(); // <--- السطر الأول والأهم في البرنامج كله

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');

// --- استيراد الوحدات الأساسية ---
const config = require('./config.js');
const state = require('./state.js');
const db = require('./database.js');
const { handleStatefulMessage } = require('./state-handler.js');
const eventHandlers = require('./event-handler.js');

// --- استيراد جميع ملفات الأوامر ---
const adminCommands = require('./commands/admin-commands.js');
const setupCommands = require('./commands/setup-handler.js');
const addLectureCommands = require('./commands/add-lecture-commands.js');
const downloadCommands = require('./commands/download-commands.js');
const aiCommands = require('./commands/ai-commands.js');
const pdfCommands = require('./commands/pdf-commands.js');
const generalCommands = require('./commands/general-commands.js');
const searchCommands = require('./commands/search-commands.js');
const courseManagementCommands = require('./commands/course-management.js');

// --- دمج جميع الأوامر في خريطة واحدة ---
const commands = {
    ...adminCommands,
    ...setupCommands,
    ...addLectureCommands,
    ...downloadCommands,
    ...aiCommands,
    ...pdfCommands,
    ...generalCommands,
    ...searchCommands,
    ...courseManagementCommands,
};

console.log('[🚀] Initializing WhatsApp client...');
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "whatsapp-bot",
        dataPath: path.join(__dirname, '.wwebjs_auth')
    }),
    puppeteer: {
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
        ],
    },
});

// --- معالجة أحداث العميل ---
client.on('qr', qr => {
    console.log('[📸] Scan the QR code below:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    state.isBotReady = true;
    console.log('[✅] Client is ready!');
    if (config.OWNER_ID) {
        await client.sendMessage(config.OWNER_ID, `✅ *البوت يعمل الآن وجاهز لاستقبال الأوامر*${config.SIGNATURE}`);
    }
});

// ... باقي الأحداث والموجه الرئيسي للرسائل ...
// (الكود هنا لم يتغير، يمكنك إبقاء الكود الأصلي من هذه النقطة)

client.on('auth_failure', msg => {
    console.error('[❌] Authentication failure:', msg);
    process.exit(1);
});

client.on('disconnected', reason => {
    console.log('[❌] Client was logged out:', reason);
});

client.on('message_create', async message => {
    if (message.fromMe || !state.isBotReady || !message.body || message.from === 'status@broadcast') {
        return;
    }
    try {
        const wasHandledByState = await handleStatefulMessage(message, client);
        if (wasHandledByState) return;

        const command = message.body.split(' ')[0].toLowerCase();
        const commandHandler = commands[command];

        if (commandHandler) {
            await commandHandler(message, client);
        }
    } catch (error) {
        console.error('[❌] An error occurred:', error);
        await message.reply(`⚠️ حدث خطأ غير متوقع.`);
    }
});

async function start() {
    try {
        await db.loadAllData();
        await db.loadCoursesData();
        console.log('[▶️] Starting client initialization...');
        await client.initialize();
    } catch (error) {
        console.error('[❌] CRITICAL STARTUP ERROR:', error);
        process.exit(1);
    }
}

start();