require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const PdfPrinter = require('pdfmake');
const { exec } = require('child_process');

// --- ربط قاعدة البيانات ---
const db = require('./database.js');

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "whatsapp-bot" }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// ============================================
// حالة البوت والبيانات
// ============================================
const userState = new Map();
const groupsMetadata = new Map();
const blacklist = new Set();
const admins = new Set(['84564227018@c.us']);
const lectureStats = new Map();
const joinStats = new Map();
const leaveStats = new Map();
const messageStats = new Map();

// هياكل البيانات الجديدة
const sections = new Map();     // الشعب
const classes = new Map();      // الفصول
const groupsData = new Map();   // الأفواج
const professors = new Map();   // الأساتذة
const subjects = new Map();     // المواد

// ============================================
// الإعدادات والمتغيرات
// ============================================
let groupId = null;
let requestCount = 0;
let isBotReady = false;
let autoMotivationEnabled = false;  // تفعيل التحفيز التلقائي

// الإعدادات - قم بتغييرها حسب احتياجاتك
const PDF_ARCHIVE_GROUP = process.env.PDF_ARCHIVE_GROUP || '120363403563982270@g.us';
const IMAGES_ARCHIVE_GROUP = process.env.IMAGES_ARCHIVE_GROUP || '120363400468776166@g.us';
const OWNER_ID = process.env.OWNER_ID || '212621957775@c.us';
const PROTECTION_PASSWORD = process.env.BOT_PASSWORD || 'your_secure_password';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// مسارات الملفات
const lecturesDir = './lectures/';
const statsFile = './stats.json';
const blacklistFile = './blacklist.json';
const sectionsFile = './sections.json';
const classesFile = './classes.json';
const groupsFile = './groups.json';
const professorsFile = './professors.json';
const subjectsFile = './subjects.json';

// إنشاء مجلد المحاضرات
if (!fs.existsSync(lecturesDir)) {
    fs.mkdirSync(lecturesDir, { recursive: true });
}

// ============================================
// دوال تحميل البيانات
// ============================================
function loadStats() {
    try {
        if (fs.existsSync(statsFile)) {
            const data = fs.readFileSync(statsFile, 'utf8');
            const stats = data ? JSON.parse(data) : {};
            joinStats.clear();
            leaveStats.clear();
            messageStats.clear();
            lectureStats.clear();
            for (const [groupId, joins] of Object.entries(stats.joins || {})) { joinStats.set(groupId, joins); }
            for (const [groupId, leaves] of Object.entries(stats.leaves || {})) { leaveStats.set(groupId, leaves); }
            for (const [groupId, messages] of Object.entries(stats.messages || {})) { messageStats.set(groupId, messages); }
            for (const [userId, lectures] of Object.entries(stats.lectures || {})) { lectureStats.set(userId, lectures); }
            console.log(`[📊] Loaded stats`);
        }
    } catch (error) { console.error('[❌] Error loading stats:', error); }
}

function loadBlacklist() {
    try {
        if (fs.existsSync(blacklistFile)) {
            const data = fs.readFileSync(blacklistFile, 'utf8');
            const list = data ? JSON.parse(data) : [];
            blacklist.clear();
            list.forEach(num => blacklist.add(num));
            console.log(`[📛] Loaded ${blacklist.size} blacklisted numbers`);
        }
    } catch (error) { console.error('[❌] Error loading blacklist:', error); }
}

function loadSections() {
    try {
        if (fs.existsSync(sectionsFile)) {
            const data = fs.readFileSync(sectionsFile, 'utf8');
            const list = data ? JSON.parse(data) : [];
            sections.clear();
            list.forEach(item => sections.set(item.id, item.name));
            console.log(`[📂] Loaded ${sections.size} sections`);
        }
    } catch (error) { console.error('[❌] Error loading sections:', error); }
}

function loadClasses() {
    try {
        if (fs.existsSync(classesFile)) {
            const data = fs.readFileSync(classesFile, 'utf8');
            const list = data ? JSON.parse(data) : [];
            classes.clear();
            list.forEach(item => classes.set(item.id, item.name));
            console.log(`[📂] Loaded ${classes.size} classes`);
        }
    } catch (error) { console.error('[❌] Error loading classes:', error); }
}

function loadGroups() {
    try {
        if (fs.existsSync(groupsFile)) {
            const data = fs.readFileSync(groupsFile, 'utf8');
            const list = data ? JSON.parse(data) : [];
            groupsData.clear();
            list.forEach(item => groupsData.set(item.id, item.name));
            console.log(`[📂] Loaded ${groupsData.size} groups`);
        }
    } catch (error) { console.error('[❌] Error loading groups:', error); }
}

function loadProfessors() {
    try {
        if (fs.existsSync(professorsFile)) {
            const data = fs.readFileSync(professorsFile, 'utf8');
            const list = data ? JSON.parse(data) : [];
            professors.clear();
            list.forEach(item => professors.set(item.id, item.name));
            console.log(`[📂] Loaded ${professors.size} professors`);
        }
    } catch (error) { console.error('[❌] Error loading professors:', error); }
}

function loadSubjects() {
    try {
        if (fs.existsSync(subjectsFile)) {
            const data = fs.readFileSync(subjectsFile, 'utf8');
            const list = data ? JSON.parse(data) : [];
            subjects.clear();
            list.forEach(item => subjects.set(item.id, item.name));
            console.log(`[📂] Loaded ${subjects.size} subjects`);
        }
    } catch (error) { console.error('[❌] Error loading subjects:', error); }
}

// ============================================
// دوال حفظ البيانات
// ============================================
function saveStats() {
    try {
        const stats = {
            joins: Object.fromEntries(joinStats),
            leaves: Object.fromEntries(leaveStats),
            messages: Object.fromEntries(messageStats),
            lectures: Object.fromEntries(lectureStats)
        };
        fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
    } catch (error) { console.error('[❌] Error saving stats:', error); }
}

function saveBlacklist() {
    try { fs.writeFileSync(blacklistFile, JSON.stringify([...blacklist])); } catch (error) { console.error('[❌] Error saving blacklist:', error); }
}

function saveSections() {
    try {
        const list = Array.from(sections.entries()).map(([id, name]) => ({ id, name }));
        fs.writeFileSync(sectionsFile, JSON.stringify(list, null, 2));
    } catch (error) { console.error('[❌] Error saving sections:', error); }
}

function saveClasses() {
    try {
        const list = Array.from(classes.entries()).map(([id, name]) => ({ id, name }));
        fs.writeFileSync(classesFile, JSON.stringify(list, null, 2));
    } catch (error) { console.error('[❌] Error saving classes:', error); }
}

function saveGroups() {
    try {
        const list = Array.from(groupsData.entries()).map(([id, name]) => ({ id, name }));
        fs.writeFileSync(groupsFile, JSON.stringify(list, null, 2));
    } catch (error) { console.error('[❌] Error saving groups:', error); }
}

function saveProfessors() {
    try {
        const list = Array.from(professors.entries()).map(([id, name]) => ({ id, name }));
        fs.writeFileSync(professorsFile, JSON.stringify(list, null, 2));
    } catch (error) { console.error('[❌] Error saving professors:', error); }
}

function saveSubjects() {
    try {
        const list = Array.from(subjects.entries()).map(([id, name]) => ({ id, name }));
        fs.writeFileSync(subjectsFile, JSON.stringify(list, null, 2));
    } catch (error) { console.error('[❌] Error saving subjects:', error); }
}

// تحميل جميع البيانات
loadStats();
loadBlacklist();
loadSections();
loadClasses();
loadGroups();
loadProfessors();
loadSubjects();

const signature = "\n👨‍💻 *dev by: IRIZI 😊*";

// ============================================
// دوال الذكاء الاصطناعي (Gemini)
// ============================================
async function askGemini(prompt, context = '') {
    try {
        if (!GEMINI_API_KEY) {
            return "⚠️ لم يتم تكوين مفتاح API للذكاء الاصطناعي.";
        }
        const fullPrompt = context ? `${context}\n\nالسؤال: ${prompt}` : prompt;
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }] })
            }
        );
        const data = await response.json();
        if (data && data.candidates && data.candidates.length > 0) {
            return data.candidates[0].content.parts[0].text;
        } else {
            return "عذراً، لم أتمكن من الحصول على إجابة من الذكاء الاصطناعي.";
        }
    } catch (error) {
        console.error('[❌] Error calling Gemini API:', error);
        return "حدث خطأ أثناء الاتصال بالذكاء الاصطناعي.";
    }
}

async function analyzeUserIntent(message, senderName, isGroup, groupName = '') {
    try {
        const context = `
أنت مساعد ذكاء اصطناعي لبوت WhatsApp. مهمتك هي تحليل نية المستخدم من رسالته والرد بشكل مناسب.
المعلومات المتاحة:
- اسم المرسل: ${senderName}
- الرسالة من مجموعة: ${isGroup ? 'نعم' : 'لا'}
${isGroup ? `- اسم المجموعة: ${groupName}` : ''}
- الرسالة: ${message}

الرد يجب أن يكون بتنسيق JSON يحتوي على:
{
  "intent": "النية (مثل: سؤال، شكوى، طلب مساعدة، إلخ)",
  "response": "الرد المناسب للمستخدم",
  "action": "إجراء يجب على البوت اتخاذه (مثل: none, notify_admin, add_to_blacklist, إلخ)",
  "confidence": "مستوى الثقة (من 0 إلى 1)"
}
`;
        const aiResponse = await askGemini(`حلل نية المستخدم من هذه الرسالة ورد بشكل مناسب.`, context);
        try {
            return JSON.parse(aiResponse);
        } catch (parseError) {
            return { intent: "unknown", response: "عذراً، لم أفهم رسالتك.", action: "none", confidence: 0.2 };
        }
    } catch (error) {
        console.error('[❌] Error analyzing user intent:', error);
        return { intent: "unknown", response: "حدث خطأ.", action: "none", confidence: 0.1 };
    }
}

async function generateWelcomeMessage(userName, groupName) {
    try {
        const context = `أنت مساعد ذكاء اصطناعي لبوت WhatsApp. أنشئ رسالة ترحيب دافئة وودية لعضو جديد في المجموعة.\nاسم العضو: ${userName}\nاسم المجموعة: ${groupName}\nالرد يجب ألا يزيد عن 3 أسطر.`;
        return await askGemini(`أنشئ رسالة ترحيب للعضو الجديد.`, context);
    } catch (error) {
        return `مرحباً ${userName} في مجموعة ${groupName}! 🎉`;
    }
}

async function generateMotivationalMessage() {
    try {
        const context = `أنت مساعد ذكاء اصطناعي لبوت WhatsApp تعليمي. أنشئ رسالة تحفيزية قصيرة ومؤثرة للطلاب تشجعهم على الدراسة والمثابرة. الرسالة يجب أن تكون بالعربية وألا تزيد عن 4 أسطر.`;
        return await askGemini(`أنشئ رسالة تحفيزية للطلاب.`, context);
    } catch (error) {
        return "🌟 لا تستسلم! كل خطوة تقربك من هدفك. استمر في التعلم والاجتهاد!";
    }
}

// ============================================
// دوال PDF
// ============================================
function checkFonts() {
    const fontsDir = path.join(__dirname, 'fonts');
    const regularFont = path.join(fontsDir, 'Amiri-Regular.ttf');
    const boldFont = path.join(fontsDir, 'Amiri-Bold.ttf');
    if (!fs.existsSync(fontsDir)) { fs.mkdirSync(fontsDir); return false; }
    if (!fs.existsSync(regularFont) || !fs.existsSync(boldFont)) return false;
    return true;
}

async function generateLecturesTablePDF(lecturesData) {
    return new Promise((resolve, reject) => {
        try {
            if (!checkFonts()) {
                reject(new Error('الخطوط المطلوبة غير موجودة. يرجى التأكد من وجود ملفات Amiri-Regular.ttf و Amiri-Bold.ttf'));
                return;
            }
            const fonts = {
                Amiri: {
                    normal: path.join(__dirname, 'fonts/Amiri-Regular.ttf'),
                    bold: path.join(__dirname, 'fonts/Amiri-Bold.ttf'),
                }
            };
            const printer = new PdfPrinter(fonts);
            const body = [
                [
                    { text: 'التسلسل', bold: true },
                    { text: 'المادة', bold: true },
                    { text: 'رقم المحاضرة', bold: true },
                    { text: 'الأستاذ', bold: true },
                    { text: 'الفوج', bold: true },
                    { text: 'التاريخ', bold: true }
                ]
            ];

            lecturesData.forEach((lecture, index) => {
                const date = lecture.date_added ? new Date(lecture.date_added).toLocaleDateString('ar-EG') : 'غير محدد';
                body.push([
                    (index + 1).toString(),
                    lecture.subject_name || '',
                    lecture.lecture_number || '',
                    lecture.professor_name || '',
                    lecture.group_name || '',
                    date
                ]);
            });

            const docDefinition = {
                defaultStyle: { font: 'Amiri', alignment: 'right', fontSize: 12 },
                content: [
                    { text: 'جدول المحاضرات', style: 'header' },
                    { text: `تاريخ الإنشاء: ${new Date().toLocaleDateString('ar-EG')}`, alignment: 'left' },
                    { table: { headerRows: 1, widths: ['auto', '*', 'auto', '*', 'auto', 'auto'], body }, layout: 'lightHorizontalLines' },
                    { text: `إجمالي المحاضرات: ${lecturesData.length}`, margin: [0, 10, 0, 0] },
                    { text: 'تم إنشاء هذا الجدول باستخدام الذكاء الاصطناعي', alignment: 'center', fontSize: 10, color: 'gray' }
                ],
                styles: { header: { fontSize: 18, bold: true, alignment: 'center', margin: [0, 0, 0, 10] } },
                pageOrientation: 'landscape', pageSize: 'A4'
            };

            const pdfDoc = printer.createPdfKitDocument(docDefinition);
            const chunks = [];
            pdfDoc.on('data', chunk => chunks.push(chunk));
            pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
            pdfDoc.on('error', error => reject(error));
            pdfDoc.end();
        } catch (error) { reject(error); }
    });
}

// ============================================
// دوال المساعدة
// ============================================
async function notifyAllGroups(messageText) {
    if (!isBotReady) return;
    try {
        const chats = await client.getChats();
        const groups = chats.filter(chat => chat.isGroup);
        for (const group of groups) {
            if (await isBotAdmin(group.id._serialized)) {
                await client.sendMessage(group.id._serialized, messageText + signature);
            }
        }
    } catch (error) { console.error('[❌] Error notifying groups:', error); }
}

async function notifyAdmins(groupId, text) {
    if (!isBotReady) return;
    try {
        const chat = await client.getChatById(groupId);
        const admins = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
        for (const admin of admins) {
            await client.sendMessage(admin.id._serialized, `📢 *Admin Notification*\n${text}${signature}`);
        }
    } catch (error) { console.error('[❌] Error notifying admins:', error); }
}

async function isAdmin(userId, groupId) {
    if (!isBotReady) return false;
    try {
        if (userId === OWNER_ID) return true;
        const chat = await client.getChatById(groupId);
        if (!chat.isGroup) return false;
        if (admins.has(userId)) return true;
        const groupAdmins = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
        return groupAdmins.some(admin => admin.id._serialized === userId);
    } catch (error) { return false; }
}

async function isBotAdmin(groupId) {
    if (!isBotReady) return false;
    try {
        const chat = await client.getChatById(groupId);
        const botId = client.info.wid._serialized;
        const groupAdmins = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
        return groupAdmins.some(admin => admin.id._serialized === botId);
    } catch (error) { return false; }
}

function formatPhoneNumber(number) {
    number = number.replace(/\D/g, '');
    if (!number.startsWith('+')) number = '+' + number;
    return number;
}

// ============================================
// أحداث العميل
// ============================================
client.on('qr', qr => {
    console.log('[📸] Scan QR code:');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => console.log('[✅] Authenticated successfully!'));
client.on('auth_failure', msg => { console.error('[❌] Authentication failure:', msg); isBotReady = false; });

client.on('ready', async () => {
    console.log('[✅] Client ready!');
    isBotReady = true;
    try {
        const chats = await client.getChats();
        for (const chat of chats) {
            if (chat.isGroup) {
                groupsMetadata.set(chat.id._serialized, chat.name);
            }
        }
        console.log(`[ℹ️] Loaded ${groupsMetadata.size} groups`);

        setTimeout(async () => {
            try {
                if (isBotReady) {
                    await client.sendMessage(OWNER_ID, '✅ البوت يعمل الآن!' + signature);
                }
            } catch (err) {
                console.log('[⚠️] تعذر إرسال رسالة للمالك (No LID). البوت يعمل.');
            }
        }, 5000);
    } catch (error) {
        console.error('[❌] Error in ready event:', error);
    }
});

client.on('disconnected', reason => { console.log('[❌] Client disconnected:', reason); isBotReady = false; });

client.on('group_join', async (notification) => {
    if (!isBotReady) return;
    const groupId = notification.chatId;
    const userId = notification.id.participant;
    if (blacklist.has(userId)) {
        if (await isBotAdmin(groupId)) await client.removeParticipant(groupId, userId);
        return;
    }
    joinStats.set(groupId, joinStats.get(groupId) || []);
    joinStats.get(groupId).push({ userId, timestamp: Date.now() });
    saveStats();
    try {
        const contact = await client.getContactById(userId);
        const userName = contact.pushname || contact.name || "عضو جديد";
        const groupName = groupsMetadata.get(groupId) || "المجموعة";
        const welcomeMessage = await generateWelcomeMessage(userName, groupName);
        await client.sendMessage(groupId, welcomeMessage);
    } catch (error) {}
});

client.on('group_leave', async (notification) => {
    if (!isBotReady) return;
    const groupId = notification.chatId;
    const userId = notification.id.participant;
    blacklist.add(userId);
    saveBlacklist();
    leaveStats.set(groupId, leaveStats.get(groupId) || []);
    leaveStats.get(groupId).push({ userId, timestamp: Date.now(), reason: 'left' });
    saveStats();
});

client.on('group_admin_changed', async (notification) => {
    if (!isBotReady) return;
    const groupId = notification.chatId;
    const userId = notification.id.participant;
    if (notification.type === 'remove' && userId === OWNER_ID) {
        if (await isBotAdmin(groupId)) {
            await client.addParticipant(groupId, OWNER_ID);
            await client.sendMessage(OWNER_ID, `⚠️ You were removed from ${groupId}!\n✅ Re-added you.${signature}`);
        }
    }
});

// ============================================
// جدولة التحفيز التلقائي
// ============================================
if (autoMotivationEnabled) {
    cron.schedule('0 9 * * *', async () => {
        console.log('[🌅] Sending daily motivation...');
        const motivationalMsg = await generateMotivationalMessage();
        await notifyAllGroups(`☀️ *تحفيز صباحي*\n\n${motivationalMsg}`);
    });
}

// ============================================
// معالج الرسائل الرئيسي
// ============================================
client.on('message_create', async message => {
    try {
        if (!isBotReady || !message || !message.from) return;
        const userId = message.from.includes('@g.us') ? message.author : message.from;
        const contact = await message.getContact();
        const senderName = contact.pushname || contact.name || "User";
        const content = message.body && typeof message.body === 'string' ? message.body.trim() : '';
        const isGroupMessage = message.from.includes('@g.us');
        const currentGroupId = isGroupMessage ? message.from : groupId;
        const replyTo = isGroupMessage ? currentGroupId : userId;
        const groupName = isGroupMessage ? (groupsMetadata.get(currentGroupId) || "المجموعة") : "";

        // ================================
        // أوامر الذكاء الاصطناعي
        // ================================
        if (content.startsWith('!ask ')) {
            const question = content.substring(5).trim();
            if (!question) { await client.sendMessage(replyTo, `⚠️ يرجى كتابة سؤال بعد الأمر !ask${signature}`); return; }
            await message.react('🤖');
            await client.sendMessage(replyTo, `🤖 *جاري معالجة سؤالك...*`);
            try {
                const aiResponse = await askGemini(question);
                await client.sendMessage(replyTo, `${aiResponse}${signature}`);
            } catch (error) {
                await client.sendMessage(replyTo, `⚠️ حدث خطأ أثناء معالجة سؤالك.${signature}`);
            }
            return;
        }

        if (content === '!analyze' || content === '!تحليل') {
            if (!isGroupMessage) { await client.sendMessage(replyTo, `⚠️ هذا الأمر يعمل في المجموعات فقط!${signature}`); return; }
            await message.react('🔍');
            await client.sendMessage(replyTo, `🔍 *جاري تحليل الرسائل الأخيرة...*`);
            try {
                const chat = await client.getChatById(currentGroupId);
                const messages = await chat.fetchMessages({ limit: 10 });
                for (const msg of messages.reverse()) {
                    if (msg.body && !msg.body.startsWith('!')) {
                        const msgContact = await msg.getContact();
                        const msgSenderName = msgContact.pushname || msgContact.name || "User";
                        const analysis = await analyzeUserIntent(msg.body, msgSenderName, true, groupName);
                        if (analysis.confidence > 0.7 && analysis.action === 'notify_admin') {
                            await notifyAdmins(currentGroupId, `🔍 *تحليل ذكاء اصطناعي*\n\n${msgSenderName}: ${msg.body}\n\nالنية: ${analysis.intent}\nالرد المقترح: ${analysis.response}`);
                        }
                    }
                }
                await client.sendMessage(replyTo, `✅ *اكتمل تحليل الرسائل!*${signature}`);
            } catch (error) { await client.sendMessage(replyTo, `⚠️ حدث خطأ أثناء تحليل الرسائل.${signature}`); }
            return;
        }

        if (content.startsWith('!generate ')) {
            const prompt = content.substring(9).trim();
            if (!prompt) { await client.sendMessage(replyTo, `⚠️ يرجى كتابة وصف!${signature}`); return; }
            await message.react('✍️');
            await client.sendMessage(replyTo, `✍️ *جاري إنشاء المحتوى...*`);
            try {
                const aiResponse = await askGemini(`أنشئ محتوى بناءً على الوصف التالي: ${prompt}`);
                await client.sendMessage(replyTo, `${aiResponse}${signature}`);
            } catch (error) { await client.sendMessage(replyTo, `⚠️ حدث خطأ.${signature}`); }
            return;
        }

        // ================================
        // أمر جدول المحاضرات
        // ================================
        if (content === '!جدول_المحاضرات' || content === '!lectures_table') {
            await message.react('📊');
            await client.sendMessage(replyTo, `📊 *جاري إنشاء جدول المحاضرات...*`);
            try {
                const res = await db.query('SELECT subject_name, lecture_number, professor_name, group_name, date_added FROM lectures ORDER BY id ASC');
                if (res.rows.length === 0) {
                    await client.sendMessage(replyTo, `⚠️ لا توجد محاضرات مضافة بعد!${signature}`);
                    await message.react('❌');
                    return;
                }
                const pdfBuffer = await generateLecturesTablePDF(res.rows);
                const media = new MessageMedia('application/pdf', pdfBuffer.toString('base64'), `جدول_المحاضرات_${new Date().toISOString().split('T')[0]}.pdf`);
                await client.sendMessage(replyTo, media, {
                    caption: `📊 *جدول المحاضرات*\n📅 التاريخ: ${new Date().toLocaleDateString('ar-EG')}\n📝 عدد المحاضرات: ${res.rows.length}\n تم إنشاؤه بواسطة IRIZI${signature}`
                });
                await message.react('✅');
            } catch (error) {
                console.error(error);
                await client.sendMessage(replyTo, `⚠️ حدث خطأ أثناء إنشاء الجدول!${signature}`);
                await message.react('❌');
            }
            return;
        }

        // ================================
        // أمر تثبيت الرسالة
        // ================================
        if (isGroupMessage && content === '!تثبيت' && message.hasQuotedMsg) {
            if (await isAdmin(userId, currentGroupId)) {
                if (await isBotAdmin(currentGroupId)) {
                    const quotedMsg = await message.getQuotedMessage();
                    await quotedMsg.pin();
                    await client.sendMessage(OWNER_ID, `✅ Pinned message in ${currentGroupId}${signature}`);
                }
            }
            return;
        }

        // ================================
        // أمر التحديث من GitHub
        // ================================
        if (!isGroupMessage && userId === OWNER_ID && content === '!تحديث') {
            await message.react('🔄');
            await client.sendMessage(userId, `🔄 *جاري سحب التحديثات من GitHub...*\nسيتم إعادة تشغيل البوت تلقائياً خلال ثوانٍ.`);
            exec('git pull origin main && pm2 restart all', async (error, stdout, stderr) => {
                if (error) {
                    console.error(`[❌] فشل التحديث: ${error.message}`);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء التحديث:\n${error.message}\n${signature}`);
                    return;
                }
            });
            return;
        }

        // ================================
        // أمر إضافة PDF
        // ================================
        if (content === '!اضافة_pdf' || content === '!add pdf') {
            if (isGroupMessage) {
                if (sections.size === 0) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ لم يتم إعداد بيانات الشعب بعد!${signature}`);
                    return;
                }
                await message.react('📄');
                await client.sendMessage(replyTo, `📄 *إضافة ملف جديد*\nمرحباً ${senderName}! 🙋‍♂️\nيرجى اختيار نوع الملف:\n1. محاضرة\n2. ملخص\n\n💡 أرسل رقم الخيار أو *إلغاء* للخروج${signature}`);
                userState.set(userId, { step: 'select_pdf_type', timestamp: Date.now() });
            } else {
                await client.sendMessage(replyTo, `⚠️ هذا الأمر يعمل في المجموعات فقط!${signature}`);
            }
            return;
        }

        // ================================
        // أمر تحميل PDF
        // ================================
        if (content === '!تحميل' || content === '!download') {
            if (isGroupMessage) {
                if (sections.size === 0) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ لم يتم إعداد بيانات الشعب بعد!${signature}`);
                    return;
                }
                await message.react('📥');
                await client.sendMessage(replyTo, `📥 *تحميل ملف PDF*\nمرحباً ${senderName}! 🙋‍♂️\nيرجى اختيار نوع الملف للبحث:\n1. محاضرة\n2. ملخص\n\n💡 أرسل رقم الخيار أو *إلغاء* للخروج${signature}`);
                userState.set(userId, { step: 'select_pdf_type_for_download', timestamp: Date.now() });
            } else {
                await client.sendMessage(replyTo, `⚠️ هذا الأمر يعمل في المجموعات فقط!${signature}`);
            }
            return;
        }

        // ================================
        // لوحة الإدارة (للمالك فقط)
        // ================================
        if (!isGroupMessage && userId === OWNER_ID && content === '!إدارة') {
            await message.react('👨‍💻');
            await client.sendMessage(userId, `👨‍💻 *لوحة الإدارة*\nاختر العملية:
1. إضافة عضو
2. حذف عضو
3. ترقية عضو
4. خفض مشرف
5. إضافة مبرمج
6. حذف مبرمج
7. تنظيف المجموعة
8. تثبيت رسالة
9. إحصائيات المجموعات
10. تحفيز المستخدمين
11. تحليل ذكاء اصطناعي
12. إنشاء محتوى
13. جدول المحاضرات
14. إدارة المحاضرات
15. إدارة الشعب
16. إدارة الفصول ⚡ *تلقائي*
17. إدارة الأفواج ⚡ *تلقائي*
18. إدارة الأساتذة ⚡ *تلقائي*
19. إدارة المواد ⚡ *تلقائي*
20. إرسال إشعار لجميع المجموعات
21. بث رسالة مخصصة

📌 *ملاحظة:* العناصر المميزة بـ ⚡ تُجلب تلقائياً من استمارة الطلاب
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
            userState.set(userId, { step: 'admin_menu', timestamp: Date.now() });
            return;
        }

        // ================================
        // معالج الحالات (State Handler)
        // ================================
        if (userState.has(userId)) {
            const state = userState.get(userId);

            if (content.toLowerCase() === 'إلغاء') {
                await message.react('❌');
                await client.sendMessage(replyTo, `✅ تم الإلغاء!${signature}`);
                userState.delete(userId);
                return;
            }

            // --- خطوات اضافة PDF ---
            if (state.step === 'select_pdf_type') {
                const option = parseInt(content);
                if (option !== 1 && option !== 2) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار 1 للمحاضرة أو 2 للملخص.${signature}`);
                    return;
                }
                state.pdfType = option === 1 ? 'محاضرة' : 'ملخص';
                state.step = 'select_section';
                userState.set(userId, state);

                let sectionsList = `📚 *اختر الشعبة*\n\n`;
                let index = 1;
                for (const [id, name] of sections) { sectionsList += `${index}. ${name}\n`; index++; }
                await client.sendMessage(replyTo, sectionsList + `\n💡 أرسل رقم الشعبة أو *إلغاء* للخروج${signature}`);
                return;
            }

            if (state.step === 'select_section') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > sections.size) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الشعبة الصحيح.${signature}`);
                    return;
                }
                const sectionId = Array.from(sections.keys())[option - 1];
                state.sectionId = sectionId;
                state.sectionName = sections.get(sectionId);
                state.step = 'waiting_form';
                userState.set(userId, state);

                await client.sendMessage(replyTo, `✅ رائع! يرجى نسخ الاستمارة التالية وملئها بدقة:\n\nرقم ${state.pdfType}: \nاسم الفصل: \nالمادة: \nالأستاذ: \nالفوج: \n\n⚠️ *ملاحظة:* املأ البيانات بعد النقطتين (:) ثم أرسلها في رسالة واحدة.${signature}`);
                return;
            }

            if (state.step === 'waiting_form') {
                const lines = content.split('\n');
                const info = {};
                lines.forEach(line => {
                    if (line.includes('رقم')) info.number = line.split(':')[1]?.trim();
                    if (line.includes('الفصل')) info.className = line.split(':')[1]?.trim();
                    if (line.includes('المادة')) info.subject = line.split(':')[1]?.trim();
                    if (line.includes('الأستاذ') || line.includes('الاستاد')) info.professor = line.split(':')[1]?.trim();
                    if (line.includes('الفوج')) info.group = line.split(':')[1]?.trim();
                });

                if (!info.number || !info.className || !info.subject || !info.professor || !info.group) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ الاستمارة ناقصة! يرجى ملء كافة البيانات.${signature}`);
                    return;
                }

                state.formData = info;
                state.step = 'waiting_pdf';
                userState.set(userId, state);
                await client.sendMessage(replyTo, `✅ تم استلام البيانات. يرجى الآن إرسال ملف الـ *PDF* المطلوبة.${signature}`);
                return;
            }

            if (state.step === 'waiting_pdf') {
                if (message.hasMedia && message.type === 'document') {
                    const media = await message.downloadMedia();
                    if (media.mimetype === 'application/pdf') {
                        await message.react('⏳');

                        const caption = `📚 *${state.pdfType} جديد*\n📖 المادة: ${state.formData.subject}\n📝 رقم: ${state.formData.number}\n🏫 الفصل: ${state.formData.className}\n👨‍🏫 الأستاذ: ${state.formData.professor}\n👥 الفوج: ${state.formData.group}\n📚 الشعبة: ${state.sectionName}\n👤 أضيف بواسطة: ${senderName}\n📅 التاريخ: ${new Date().toLocaleDateString('ar-EG')}\n${signature}`;

                        try {
                            const archiveMsg = await client.sendMessage(PDF_ARCHIVE_GROUP, media, { caption });
                            const messageId = archiveMsg.id._serialized;

                            const query = `INSERT INTO lectures (type, section_id, section_name, class_name, subject_name, professor_name, group_name, lecture_number, message_id, added_by, date_added, file_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;

                            await db.query(query, [
                                state.pdfType, state.sectionId, state.sectionName,
                                state.formData.className, state.formData.subject,
                                state.formData.professor, state.formData.group,
                                state.formData.number, messageId, userId, new Date().toISOString(), media.filename || `${state.pdfType}.pdf`
                            ]);

                            // ========================================
                            // حفظ البيانات تلقائياً من الاستمارة
                            // (الفصول، الأفواج، الأساتذة، المواد)
                            // ========================================
                            let newItemsAdded = [];

                            // إضافة الفصل إذا لم يكن موجوداً
                            const className = state.formData.className.trim();
                            if (className && !Array.from(classes.values()).includes(className)) {
                                const classId = Date.now().toString();
                                classes.set(classId, className);
                                saveClasses();
                                newItemsAdded.push(`🏫 فصل: ${className}`);
                            }

                            // إضافة الفوج إذا لم يكن موجوداً
                            const groupName = state.formData.group.trim();
                            if (groupName && !Array.from(groupsData.values()).includes(groupName)) {
                                const groupIdNew = Date.now().toString() + '_g';
                                groupsData.set(groupIdNew, groupName);
                                saveGroups();
                                newItemsAdded.push(`👥 فوج: ${groupName}`);
                            }

                            // إضافة الأستاذ إذا لم يكن موجوداً
                            const professorName = state.formData.professor.trim();
                            if (professorName && !Array.from(professors.values()).includes(professorName)) {
                                const profId = Date.now().toString() + '_p';
                                professors.set(profId, professorName);
                                saveProfessors();
                                newItemsAdded.push(`👨‍🏫 أستاذ: ${professorName}`);
                            }

                            // إضافة المادة إذا لم تكن موجودة
                            const subjectName = state.formData.subject.trim();
                            if (subjectName && !Array.from(subjects.values()).includes(subjectName)) {
                                const subjId = Date.now().toString() + '_s';
                                subjects.set(subjId, subjectName);
                                saveSubjects();
                                newItemsAdded.push(`📖 مادة: ${subjectName}`);
                            }

                            // إرسال رسالة نجاح مع العناصر الجديدة
                            let successMsg = `✅ *تم الحفظ بنجاح!*\nتم تأمين الملف في قاعدة البيانات والأرشيف.`;
                            if (newItemsAdded.length > 0) {
                                successMsg += `\n\n🆕 *تم إضافة عناصر جديدة تلقائياً:*\n${newItemsAdded.join('\n')}`;
                            }
                            await client.sendMessage(replyTo, successMsg + signature);
                            userState.delete(userId);
                            await message.react('✅');
                        } catch (err) {
                            console.error("[❌] DB Error:", err);
                            await message.react('❌');
                            await client.sendMessage(replyTo, `⚠️ حدث خطأ أثناء الحفظ في القاعدة، لكن تم الرفع للأرشيف.${signature}`);
                            userState.delete(userId);
                        }
                    } else {
                        await message.react('⚠️');
                        await client.sendMessage(replyTo, `⚠️ يرجى إرسال ملف PDF فقط!${signature}`);
                    }
                } else {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ يرجى إرسال ملف PDF!${signature}`);
                }
                return;
            }

            // --- خطوات تحميل PDF ---
            if (state.step === 'select_pdf_type_for_download') {
                const option = parseInt(content);
                if (option !== 1 && option !== 2) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار 1 أو 2.${signature}`);
                    return;
                }
                state.pdfType = option === 1 ? 'محاضرة' : 'ملخص';
                state.step = 'select_section_for_download';
                userState.set(userId, state);

                let sectionsList = `📚 *اختر الشعبة*\n\n`;
                let index = 1;
                for (const [id, name] of sections) {
                    sectionsList += `${index}. ${name}\n`;
                    index++;
                }
                await client.sendMessage(replyTo, sectionsList + `\n💡 أرسل رقم الشعبة أو *إلغاء* للخروج${signature}`);
                return;
            }

            if (state.step === 'select_section_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > sections.size) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الشعبة الصحيح.${signature}`);
                    return;
                }
                const sectionId = Array.from(sections.keys())[option - 1];
                state.sectionName = sections.get(sectionId);

                try {
                    const query = `SELECT DISTINCT class_name FROM lectures WHERE type = $1 AND section_name = $2`;
                    const res = await db.query(query, [state.pdfType, state.sectionName]);

                    if (res.rows.length === 0) {
                        await client.sendMessage(replyTo, `⚠️ لا توجد ${state.pdfType} متوفرة حالياً لشعبة "${state.sectionName}".\nأرسل *إلغاء* للخروج.${signature}`);
                        userState.delete(userId);
                        return;
                    }

                    state.availableClasses = res.rows.map(row => row.class_name);
                    state.step = 'select_class_for_download';
                    userState.set(userId, state);

                    let classesList = `🏫 *اختر الفصل*\n\n`;
                    state.availableClasses.forEach((className, index) => {
                        classesList += `${index + 1}. الفصل: ${className}\n`;
                    });

                    await client.sendMessage(replyTo, classesList + `\n💡 أرسل رقم الفصل أو *إلغاء* للخروج${signature}`);
                } catch (err) {
                    console.error(err);
                    await client.sendMessage(replyTo, `⚠️ حدث خطأ أثناء جلب الفصول من قاعدة البيانات!${signature}`);
                    userState.delete(userId);
                }
                return;
            }

            if (state.step === 'select_class_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > state.availableClasses.length) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الفصل الصحيح.${signature}`);
                    return;
                }

                state.className = state.availableClasses[option - 1];

                const query = `SELECT * FROM lectures WHERE type = $1 AND section_name = $2 AND class_name = $3 ORDER BY id DESC`;
                try {
                    const res = await db.query(query, [state.pdfType, state.sectionName, state.className]);
                    if (res.rows.length === 0) {
                        await client.sendMessage(replyTo, `⚠️ لا توجد ${state.pdfType} متوفرة لشعبة "${state.sectionName}" فصل "${state.className}".\nأرسل *إلغاء* للخروج.${signature}`);
                        userState.delete(userId);
                        return;
                    }

                    state.availableLectures = res.rows;
                    state.step = 'select_lecture_for_download';
                    userState.set(userId, state);

                    let lecturesList = `📄 *قائمة الـ ${state.pdfType} المتوفرة*\n`;
                    lecturesList += `📚 الشعبة: ${state.sectionName} | 🏫 الفصل: ${state.className}\n\n`;

                    res.rows.forEach((lecture, index) => {
                        lecturesList += `${index + 1}. 📖 المادة: ${lecture.subject_name}\n`;
                        lecturesList += `   📝 رقم ${state.pdfType}: ${lecture.lecture_number}\n`;
                        lecturesList += `   👨‍🏫 الأستاذ: ${lecture.professor_name}\n`;
                        lecturesList += `   👥 الفوج: ${lecture.group_name}\n\n`;
                    });
                    lecturesList += `💡 أرسل رقم الملف لتحميله أو *إلغاء* للخروج${signature}`;

                    await client.sendMessage(replyTo, lecturesList);
                } catch (err) {
                    console.error(err);
                    await client.sendMessage(replyTo, `⚠️ حدث خطأ في قاعدة البيانات أثناء البحث!${signature}`);
                    userState.delete(userId);
                }
                return;
            }

            if (state.step === 'select_lecture_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > state.availableLectures.length) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }

                const lecture = state.availableLectures[option - 1];
                try {
                    const media = await client.getMessageById(lecture.message_id);
                    if (media && media.hasMedia) {
                        const mediaData = await media.downloadMedia();
                        await client.sendMessage(replyTo, mediaData, { caption: `📄 ${lecture.subject_name} - ${lecture.type} ${lecture.lecture_number}${signature}` });
                        await message.react('✅');
                    } else {
                        await client.sendMessage(replyTo, `⚠️ الملف غير متاح!${signature}`);
                    }
                } catch (err) {
                    console.error(err);
                    await client.sendMessage(replyTo, `⚠️ حدث خطأ أثناء تحميل الملف!${signature}`);
                }
                userState.delete(userId);
                return;
            }

            // ================================
            // لوحة الإدارة - التنفيذ الكامل
            // ================================
            if (userId === OWNER_ID) {
                // --- القائمة الرئيسية ---
                if (state.step === 'admin_menu') {
                    const option = parseInt(content);
                    if (isNaN(option) || option < 1 || option > 21) {
                        await client.sendMessage(userId, `⚠️ خيار غير صحيح!`);
                        return;
                    }

                    // خيار 5: إضافة مبرمج
                    if (option === 5) {
                        await client.sendMessage(userId, `📞 أرسل رقم المبرمج الجديد (مثال: 212600000000):`);
                        userState.set(userId, { step: 'add_dev_number', timestamp: Date.now() });
                        return;
                    }

                    // خيار 6: حذف مبرمج
                    if (option === 6) {
                        await client.sendMessage(userId, `📞 أرسل رقم المبرمج لإزالته (مثال: 212600000000):`);
                        userState.set(userId, { step: 'remove_dev_number', timestamp: Date.now() });
                        return;
                    }

                    // خيار 8: تثبيت رسالة
                    if (option === 8) {
                        await client.sendMessage(userId, `📌 *تثبيت رسالة*\nفي المجموعة، اعمل ريبلي للرسالة اللي عايز تثبتها واكتب:\n!تثبيت`);
                        userState.delete(userId);
                        return;
                    }

                    // خيار 10: تحفيز المستخدمين (مفعّل بالكامل)
                    if (option === 10) {
                        await client.sendMessage(userId, `🌟 *خيارات التحفيز*\n1. تفعيل التحفيز التلقائي (صباحي)\n2. إيقاف التحفيز التلقائي\n3. إرسال تحفيز الآن\n4. رجوع`);
                        userState.set(userId, { step: 'motivation_menu', timestamp: Date.now() });
                        return;
                    }

                    // خيار 11: تحليل AI
                    if (option === 11) {
                        await client.sendMessage(userId, `🔍 أرسل النص أو السؤال الذي تريد أن يحلله الذكاء الاصطناعي:`);
                        userState.set(userId, { step: 'ai_analysis_execute', timestamp: Date.now() });
                        return;
                    }

                    // خيار 12: إنشاء محتوى
                    if (option === 12) {
                        await client.sendMessage(userId, `✍️ أرسل وصف المحتوى الذي تريد من الذكاء الاصطناعي إنشاؤه:`);
                        userState.set(userId, { step: 'ai_generate_execute', timestamp: Date.now() });
                        return;
                    }

                    // خيار 13: جدول المحاضرات
                    if (option === 13) {
                        try {
                            const res = await db.query('SELECT subject_name, lecture_number, professor_name, group_name, date_added FROM lectures ORDER BY id ASC');
                            if (res.rows.length === 0) {
                                await client.sendMessage(userId, `⚠️ لا توجد محاضرات!`);
                                userState.delete(userId);
                                return;
                            }
                            const pdfBuffer = await generateLecturesTablePDF(res.rows);
                            const media = new MessageMedia('application/pdf', pdfBuffer.toString('base64'), `جدول.pdf`);
                            await client.sendMessage(userId, media, { caption: `📊 الجدول` });
                        } catch (e) { console.error(e); }
                        userState.delete(userId);
                        return;
                    }

                    // خيار 14: إدارة المحاضرات
                    if (option === 14) {
                        await client.sendMessage(userId, `📚 *إدارة المحاضرات*\n1. عرض جميع المحاضرات\n2. تعديل محاضرة\n3. حذف محاضرة`);
                        userState.set(userId, { step: 'lectures_management_menu', timestamp: Date.now() });
                        return;
                    }

                    // خيار 15: إدارة الشعب (يدوية)
                    if (option === 15) {
                        await client.sendMessage(userId, `📋 *إدارة الشعب*\n1. عرض الكل\n2. إضافة جديد\n3. تعديل\n4. حذف`);
                        userState.set(userId, { step: 'sections_management_menu', timestamp: Date.now() });
                        return;
                    }

                    // خيارات 16-19: بيانات تُجلب تلقائياً من الاستمارة
                    // (الفصول، الأفواج، الأساتذة، المواد)
                    if (option >= 16 && option <= 19) {
                        const maps = { 16: 'classes', 17: 'groups', 18: 'professors', 19: 'subjects' };
                        const names = { 16: 'فصل', 17: 'فوج', 18: 'أستاذ', 19: 'مادة' };
                        const titles = { 16: 'الفصول', 17: 'الأفواج', 18: 'الأساتذة', 19: 'المواد' };
                        await client.sendMessage(userId, `📋 *إدارة ${titles[option]}*\n📌 *ملاحظة:* يتم إضافة ${names[option]} تلقائياً من استمارة الطلاب\n\n1. عرض الكل\n2. حذف عنصر`);
                        userState.set(userId, { step: `${maps[option]}_auto_management_menu`, timestamp: Date.now() });
                        return;
                    }

                    // خيار 20: إرسال إشعار لجميع المجموعات
                    if (option === 20) {
                        await client.sendMessage(userId, `📢 أرسل الرسالة التي تريد بثها لجميع المجموعات:`);
                        userState.set(userId, { step: 'broadcast_message', timestamp: Date.now() });
                        return;
                    }

                    // خيار 21: بث رسالة مخصصة
                    if (option === 21) {
                        let groupList = `📋 *اختر المجموعة للبث*\n`;
                        let index = 1;
                        for (const [id, name] of groupsMetadata) {
                            groupList += `${index}. ${name}\n`;
                            index++;
                        }
                        await client.sendMessage(userId, groupList + `\n💡 أرسل رقم المجموعة أو *إلغاء*`);
                        userState.set(userId, { step: 'select_group_for_broadcast', timestamp: Date.now() });
                        return;
                    }

                    // خيار 9: إحصائيات
                    if (option === 9) {
                        await client.sendMessage(userId, `📊 *إحصائيات المجموعات*\n1. الأعضاء المنضمين\n2. الأعضاء الذين غادروا\n3. نشاط الرسائل\n4. المحاضرات المضافة\n5. إحصائيات شاملة`);
                        userState.set(userId, { step: 'stats_menu', timestamp: Date.now() });
                        return;
                    }

                    // الخيارات 1، 2، 3، 4، 7 (تحتاج اختيار مجموعة)
                    let groupList = `📋 *اختر المجموعة*\n`;
                    let index = 1;
                    for (const [id, name] of groupsMetadata) {
                        groupList += `${index}. ${name}\n`;
                        index++;
                    }
                    await client.sendMessage(userId, groupList);
                    userState.set(userId, { step: `admin_option_${option}_select_group`, timestamp: Date.now() });
                    return;
                }

                // ================================
                // تنفيذ خيارات المجموعة (1، 2، 3، 4، 7)
                // ================================
                if (state.step && state.step.startsWith('admin_option_')) {
                    const match = state.step.match(/admin_option_(\d+)_select_group/);
                    if (match) {
                        const opt = parseInt(match[1]);
                        const groupIndex = parseInt(content) - 1;
                        const groupsArray = Array.from(groupsMetadata.entries());

                        if (isNaN(groupIndex) || groupIndex < 0 || groupIndex >= groupsArray.length) {
                            await client.sendMessage(userId, '⚠️ اختيار خاطئ للمجموعة.');
                            return;
                        }
                        const selectedGroupId = groupsArray[groupIndex][0];

                        // خيار تنظيف المجموعة (7)
                        if (opt === 7) {
                            await client.sendMessage(userId, '🧹 جاري تنظيف المجموعة من الأعضاء المحظورين...');
                            let kicked = 0;
                            try {
                                const chat = await client.getChatById(selectedGroupId);
                                for (const participant of chat.participants) {
                                    if (blacklist.has(participant.id._serialized)) {
                                        await chat.removeParticipants([participant.id._serialized]);
                                        kicked++;
                                    }
                                }
                                await client.sendMessage(userId, `✅ تم التنظيف! تم طرد ${kicked} عضو محظور.`);
                            } catch (e) {
                                await client.sendMessage(userId, '⚠️ خطأ (تأكد أن البوت مشرف في المجموعة).');
                            }
                            userState.delete(userId);
                            return;
                        }

                        // الخيارات 1، 2، 3، 4 تطلب إدخال رقم هاتف
                        const actions = { 1: 'إضافته', 2: 'حذفه', 3: 'ترقيته', 4: 'خفض رتبته' };
                        await client.sendMessage(userId, `📞 أرسل رقم العضو المراد ${actions[opt]} (مثال: 212600000000):`);
                        userState.set(userId, { step: `admin_execute_${opt}`, groupId: selectedGroupId, timestamp: Date.now() });
                        return;
                    }
                }

                // تنفيذ إجراء المجموعة الفعلي
                if (state.step && state.step.startsWith('admin_execute_')) {
                    const match = state.step.match(/admin_execute_(\d+)/);
                    if (match) {
                        const opt = parseInt(match[1]);
                        const targetNumber = content.replace(/\D/g, '') + '@c.us';
                        try {
                            const chat = await client.getChatById(state.groupId);
                            if (opt === 1) await chat.addParticipants([targetNumber]);
                            if (opt === 2) await chat.removeParticipants([targetNumber]);
                            if (opt === 3) await chat.promoteParticipants([targetNumber]);
                            if (opt === 4) await chat.demoteParticipants([targetNumber]);
                            await client.sendMessage(userId, `✅ تمت العملية بنجاح!`);
                        } catch (err) {
                            await client.sendMessage(userId, `⚠️ حدث خطأ. تأكد أن البوت مشرف وأن الرقم صحيح ومسجل بالواتساب.`);
                        }
                        userState.delete(userId);
                        return;
                    }
                }

                // ================================
                // خيارات المبرمجين (5، 6)
                // ================================
                if (state.step === 'add_dev_number') {
                    const num = content.replace(/\D/g, '') + '@c.us';
                    admins.add(num);
                    await client.sendMessage(userId, `✅ تم إضافة المبرمج بنجاح.`);
                    userState.delete(userId);
                    return;
                }

                if (state.step === 'remove_dev_number') {
                    const num = content.replace(/\D/g, '') + '@c.us';
                    admins.delete(num);
                    await client.sendMessage(userId, `✅ تم إزالة المبرمج بنجاح.`);
                    userState.delete(userId);
                    return;
                }

                // ================================
                // خيار التحفيز (10) - مفعّل بالكامل
                // ================================
                if (state.step === 'motivation_menu') {
                    const opt = parseInt(content);
                    if (opt === 1) {
                        autoMotivationEnabled = true;
                        await client.sendMessage(userId, `✅ تم تفعيل التحفيز التلقائي!\n🌅 سيتم إرسال رسالة تحفيزية يومياً في الساعة 9 صباحاً لجميع المجموعات.`);
                    } else if (opt === 2) {
                        autoMotivationEnabled = false;
                        await client.sendMessage(userId, `⏹️ تم إيقاف التحفيز التلقائي.`);
                    } else if (opt === 3) {
                        await client.sendMessage(userId, `⏳ جاري إرسال رسالة تحفيزية...`);
                        const motivationalMsg = await generateMotivationalMessage();
                        await notifyAllGroups(`🌟 *رسالة تحفيزية*\n\n${motivationalMsg}`);
                        await client.sendMessage(userId, `✅ تم إرسال التحفيز لجميع المجموعات!`);
                    } else if (opt === 4) {
                        await client.sendMessage(userId, `👨‍💻 *لوحة الإدارة*\nاختر العملية...`);
                        userState.set(userId, { step: 'admin_menu', timestamp: Date.now() });
                        return;
                    } else {
                        await client.sendMessage(userId, `⚠️ خيار غير صحيح!`);
                    }
                    userState.delete(userId);
                    return;
                }

                // ================================
                // الإحصائيات (9)
                // ================================
                if (state.step === 'stats_menu') {
                    const opt = parseInt(content);
                    let msg = '';
                    if (opt === 1) {
                        msg = `📈 *إحصائيات الانضمام*\n\n`;
                        for (const [gid, joins] of joinStats) {
                            const gname = groupsMetadata.get(gid) || gid;
                            msg += `📁 ${gname}: ${joins.length} عضو انضم\n`;
                        }
                    } else if (opt === 2) {
                        msg = `📉 *إحصائيات المغادرة*\n\n`;
                        for (const [gid, leaves] of leaveStats) {
                            const gname = groupsMetadata.get(gid) || gid;
                            msg += `📁 ${gname}: ${leaves.length} عضو غادر\n`;
                        }
                    } else if (opt === 3) {
                        msg = `💬 *نشاط الرسائل*\n\n`;
                        for (const [gid, messages] of messageStats) {
                            const gname = groupsMetadata.get(gid) || gid;
                            msg += `📁 ${gname}: ${messages.length} رسالة\n`;
                        }
                    } else if (opt === 4) {
                        msg = `📚 *المحاضرات المضافة*\n\n`;
                        for (const [uid, lectures] of lectureStats) {
                            msg += `👤 ${uid}: ${lectures.length} محاضرة\n`;
                        }
                    } else if (opt === 5) {
                        msg = `📊 *إحصائيات شاملة*\n\n`;
                        msg += `📁 عدد المجموعات: ${groupsMetadata.size}\n`;
                        msg += `👤 عدد المبرمجين: ${admins.size}\n`;
                        msg += `📛 القائمة السوداء: ${blacklist.size} رقم\n`;
                        msg += `📚 عدد الشعب: ${sections.size}\n`;
                        msg += `🏫 عدد الفصول: ${classes.size}\n`;
                        msg += `👥 عدد الأفواج: ${groupsData.size}\n`;
                        msg += `👨‍🏫 عدد الأساتذة: ${professors.size}\n`;
                        msg += `📖 عدد المواد: ${subjects.size}\n`;
                    } else {
                        msg = '⚠️ خيار خاطئ';
                    }
                    await client.sendMessage(userId, msg + signature);
                    userState.delete(userId);
                    return;
                }

                // ================================
                // الذكاء الاصطناعي (11، 12)
                // ================================
                if (state.step === 'ai_analysis_execute') {
                    await client.sendMessage(userId, '⏳ جاري التحليل عبر الذكاء الاصطناعي...');
                    const res = await askGemini(`قم بتحليل هذا الطلب وتقديم رد مناسب: ${content}`);
                    await client.sendMessage(userId, res);
                    userState.delete(userId);
                    return;
                }

                if (state.step === 'ai_generate_execute') {
                    await client.sendMessage(userId, '⏳ جاري كتابة المحتوى عبر الذكاء الاصطناعي...');
                    const res = await askGemini(`اكتب محتوى تفصيلي عن: ${content}`);
                    await client.sendMessage(userId, res);
                    userState.delete(userId);
                    return;
                }

                // ================================
                // البث (20، 21)
                // ================================
                if (state.step === 'broadcast_message') {
                    await client.sendMessage(userId, '⏳ جاري البث لجميع المجموعات...');
                    let sent = 0;
                    const chats = await client.getChats();
                    const groups = chats.filter(chat => chat.isGroup);
                    for (const group of groups) {
                        try {
                            await client.sendMessage(group.id._serialized, content + signature);
                            sent++;
                        } catch (e) {}
                    }
                    await client.sendMessage(userId, `✅ تم البث إلى ${sent} مجموعة بنجاح!`);
                    userState.delete(userId);
                    return;
                }

                if (state.step === 'select_group_for_broadcast') {
                    const groupIndex = parseInt(content) - 1;
                    const groupsArray = Array.from(groupsMetadata.entries());
                    if (isNaN(groupIndex) || groupIndex < 0 || groupIndex >= groupsArray.length) {
                        await client.sendMessage(userId, '⚠️ اختيار خاطئ.');
                        return;
                    }
                    state.broadcastGroupId = groupsArray[groupIndex][0];
                    await client.sendMessage(userId, `📝 أرسل الرسالة للبث في هذه المجموعة:`);
                    userState.set(userId, { step: 'broadcast_to_selected_group', broadcastGroupId: state.broadcastGroupId, timestamp: Date.now() });
                    return;
                }

                if (state.step === 'broadcast_to_selected_group') {
                    try {
                        await client.sendMessage(state.broadcastGroupId, content + signature);
                        await client.sendMessage(userId, `✅ تم إرسال الرسالة!`);
                    } catch (e) {
                        await client.sendMessage(userId, `⚠️ فشل الإرسال.`);
                    }
                    userState.delete(userId);
                    return;
                }

                // ================================
                // إدارة المحاضرات (14)
                // ================================
                if (state.step === 'lectures_management_menu') {
                    const option = parseInt(content);
                    if (option === 1) {
                        const res = await db.query('SELECT * FROM lectures ORDER BY id ASC');
                        let lecturesList = `📋 *جميع المحاضرات*\n\n`;
                        if (res.rows.length === 0) lecturesList += `⚠️ لا توجد محاضرات مضافة بعد!\n`;
                        res.rows.forEach((lecture, index) => {
                            lecturesList += `${index + 1}. ${lecture.subject_name} - ${lecture.type} ${lecture.lecture_number}\n`;
                            lecturesList += `   👨‍🏫 الأستاذ: ${lecture.professor_name} | الفوج: ${lecture.group_name}\n\n`;
                        });
                        await client.sendMessage(userId, lecturesList + signature);
                        userState.delete(userId);
                        return;
                    }
                    if (option === 2) {
                        const res = await db.query('SELECT * FROM lectures ORDER BY id ASC');
                        state.adminLectures = res.rows;
                        let lecturesList = `✏️ *اختر المحاضرة للتعديل*\n\n`;
                        res.rows.forEach((lecture, index) => {
                            lecturesList += `${index + 1}. ${lecture.subject_name} - ${lecture.type} ${lecture.lecture_number}\n`;
                        });
                        await client.sendMessage(userId, lecturesList + `\n💡 أرسل رقم المحاضرة أو *إلغاء*${signature}`);
                        userState.set(userId, { step: 'edit_lecture_select', adminLectures: res.rows, timestamp: Date.now() });
                        return;
                    }
                    if (option === 3) {
                        const res = await db.query('SELECT * FROM lectures ORDER BY id ASC');
                        state.adminLectures = res.rows;
                        let lecturesList = `🗑️ *اختر المحاضرة للحذف*\n\n`;
                        res.rows.forEach((lecture, index) => {
                            lecturesList += `${index + 1}. ${lecture.subject_name} - ${lecture.type} ${lecture.lecture_number}\n`;
                        });
                        await client.sendMessage(userId, lecturesList + `\n💡 أرسل رقم المحاضرة أو *إلغاء*${signature}`);
                        userState.set(userId, { step: 'delete_lecture_select', adminLectures: res.rows, timestamp: Date.now() });
                        return;
                    }
                }

                if (state.step === 'edit_lecture_select') {
                    const idx = parseInt(content) - 1;
                    if (isNaN(idx) || idx < 0 || idx >= state.adminLectures.length) return;
                    const lecture = state.adminLectures[idx];
                    await client.sendMessage(userId, `✏️ *تعديل محاضرة*\nأرسل المعلومات الجديدة:\n\n📖 اسم المادة:\n📝 رقم:\n👨‍🏫 اسم الأستاذ:\n👥 رقم الفوج:\n🏫 اسم الفصل:\n📚 اسم الشعبة:\n`);
                    userState.set(userId, { step: 'edit_lecture_data', dbId: lecture.id, timestamp: Date.now() });
                    return;
                }

                if (state.step === 'edit_lecture_data') {
                    const lines = content.split('\n');
                    const info = {};
                    lines.forEach(line => {
                        if (line.includes('اسم المادة')) info.subject = line.split(':')[1]?.trim();
                        if (line.includes('رقم')) info.number = line.split(':')[1]?.trim();
                        if (line.includes('الأستاذ') || line.includes('الاساذ')) info.professor = line.split(':')[1]?.trim();
                        if (line.includes('الفوج')) info.group = line.split(':')[1]?.trim();
                        if (line.includes('الفصل')) info.className = line.split(':')[1]?.trim();
                        if (line.includes('الشعبة')) info.section = line.split(':')[1]?.trim();
                    });
                    try {
                        await db.query(`UPDATE lectures SET subject_name=$1, lecture_number=$2, professor_name=$3, group_name=$4, class_name=$5, section_name=$6 WHERE id=$7`,
                            [info.subject, info.number, info.professor, info.group, info.className, info.section, state.dbId]);
                        await client.sendMessage(userId, `✅ تم التعديل بنجاح!`);
                    } catch (err) {
                        console.error(err);
                        await client.sendMessage(userId, `⚠️ خطأ في التعديل!`);
                    }
                    userState.delete(userId);
                    return;
                }

                if (state.step === 'delete_lecture_select') {
                    const idx = parseInt(content) - 1;
                    if (isNaN(idx) || idx < 0 || idx >= state.adminLectures.length) return;
                    const lecture = state.adminLectures[idx];
                    await client.sendMessage(userId, `🗑️ هل أنت متأكد من حذف ${lecture.subject_name} رقم ${lecture.lecture_number}؟ (نعم/لا)`);
                    userState.set(userId, { step: 'delete_lecture_confirm', dbId: lecture.id, timestamp: Date.now() });
                    return;
                }

                if (state.step === 'delete_lecture_confirm') {
                    if (content.toLowerCase() === 'نعم') {
                        try {
                            await db.query(`DELETE FROM lectures WHERE id=$1`, [state.dbId]);
                            await client.sendMessage(userId, `✅ تم الحذف من قاعدة البيانات!`);
                        } catch (err) {
                            await client.sendMessage(userId, `⚠️ خطأ!`);
                        }
                    }
                    userState.delete(userId);
                    return;
                }

                // ================================
                // إدارة الشعب (يدوية - خيار 15)
                // ================================
                if (state.step === 'sections_management_menu') {
                    const option = parseInt(content);
                    if (option === 1) {
                        let list = `📋 *جميع الشعب*\n\n`;
                        if (sections.size === 0) list += `⚠️ لا توجد شعب مضافة!\n`;
                        sections.forEach((name, id) => { list += `${id}. ${name}\n`; });
                        await client.sendMessage(userId, list);
                        userState.delete(userId);
                        return;
                    }
                    if (option === 2) {
                        await client.sendMessage(userId, `➕ أرسل اسم الشعبة الجديدة:`);
                        userState.set(userId, { step: 'add_sections', timestamp: Date.now() });
                        return;
                    }
                    if (option === 3) {
                        let list = `✏️ اختر رقم الشعبة للتعديل:\n`;
                        sections.forEach((name, id) => { list += `${id}. ${name}\n`; });
                        await client.sendMessage(userId, list);
                        userState.set(userId, { step: 'edit_sections_select', timestamp: Date.now() });
                        return;
                    }
                    if (option === 4) {
                        let list = `🗑️ اختر رقم الشعبة للحذف:\n`;
                        sections.forEach((name, id) => { list += `${id}. ${name}\n`; });
                        await client.sendMessage(userId, list);
                        userState.set(userId, { step: 'delete_sections_select', timestamp: Date.now() });
                        return;
                    }
                }

                // --- إضافة/تعديل/حذف الشعب ---
                if (state.step === 'add_sections') {
                    const newId = Date.now().toString();
                    sections.set(newId, content.trim());
                    saveSections();
                    await client.sendMessage(userId, `✅ تمت إضافة الشعبة بنجاح!`);
                    userState.delete(userId);
                    return;
                }

                if (state.step === 'edit_sections_select') {
                    if (!sections.has(content.trim())) {
                        await client.sendMessage(userId, `⚠️ الرقم غير موجود!`);
                        return;
                    }
                    await client.sendMessage(userId, `✏️ أرسل الاسم الجديد:`);
                    userState.set(userId, { step: 'edit_sections_data', editId: content.trim(), timestamp: Date.now() });
                    return;
                }

                if (state.step === 'edit_sections_data') {
                    sections.set(state.editId, content.trim());
                    saveSections();
                    await client.sendMessage(userId, `✅ تم التعديل!`);
                    userState.delete(userId);
                    return;
                }

                if (state.step === 'delete_sections_select') {
                    if (!sections.has(content.trim())) {
                        await client.sendMessage(userId, `⚠️ الرقم غير موجود!`);
                        return;
                    }
                    await client.sendMessage(userId, `🗑️ متأكد من الحذف؟ (نعم/لا)`);
                    userState.set(userId, { step: 'delete_sections_confirm', delId: content.trim(), timestamp: Date.now() });
                    return;
                }

                if (state.step === 'delete_sections_confirm') {
                    if (content.toLowerCase() === 'نعم') {
                        sections.delete(state.delId);
                        saveSections();
                        await client.sendMessage(userId, `✅ تم الحذف!`);
                    }
                    userState.delete(userId);
                    return;
                }

                // ================================
                // إدارة البيانات التلقائية (16-19)
                // (الفصول، الأفواج، الأساتذة، المواد)
                // تُجلب تلقائياً من استمارة الطلاب
                // ================================
                const autoDataMenus = {
                    'classes': { map: classes, save: saveClasses, name: 'فصل', title: 'الفصول' },
                    'groups': { map: groupsData, save: saveGroups, name: 'فوج', title: 'الأفواج' },
                    'professors': { map: professors, save: saveProfessors, name: 'أستاذ', title: 'الأساتذة' },
                    'subjects': { map: subjects, save: saveSubjects, name: 'مادة', title: 'المواد' }
                };

                for (const [key, data] of Object.entries(autoDataMenus)) {
                    // --- قائمة الإدارة (عرض وحذف فقط) ---
                    if (state.step === `${key}_auto_management_menu`) {
                        const option = parseInt(content);
                        if (option === 1) {
                            // عرض الكل
                            let list = `📋 *جميع ${data.title}*\n\n`;
                            if (data.map.size === 0) {
                                list += `⚠️ لا توجد بيانات!\n`;
                                list += `📌 سيتم إضافة ${data.name} تلقائياً عند إضافة الطلاب للمحاضرات.\n`;
                            } else {
                                let index = 1;
                                data.map.forEach((name, id) => {
                                    list += `${index}. ${name}\n`;
                                    index++;
                                });
                            }
                            await client.sendMessage(userId, list);
                            userState.delete(userId);
                            return;
                        }
                        if (option === 2) {
                            // حذف عنصر
                            if (data.map.size === 0) {
                                await client.sendMessage(userId, `⚠️ لا توجد بيانات للحذف!`);
                                userState.delete(userId);
                                return;
                            }
                            let list = `🗑️ *اختر ${data.name} للحذف:*\n\n`;
                            let index = 1;
                            const items = [];
                            data.map.forEach((name, id) => {
                                list += `${index}. ${name}\n`;
                                items.push({ id, name });
                                index++;
                            });
                            list += `\n💡 أرسل رقم العنصر أو *إلغاء*`;
                            await client.sendMessage(userId, list);
                            userState.set(userId, { step: `delete_auto_${key}_select`, items: items, timestamp: Date.now() });
                            return;
                        }
                    }

                    // --- تأكيد الحذف للبيانات التلقائية ---
                    if (state.step === `delete_auto_${key}_select`) {
                        const option = parseInt(content);
                        if (isNaN(option) || option < 1 || option > state.items.length) {
                            await client.sendMessage(userId, `⚠️ خيار غير صحيح!`);
                            return;
                        }
                        const itemToDelete = state.items[option - 1];
                        await client.sendMessage(userId, `🗑️ متأكد من حذف "${itemToDelete.name}"؟ (نعم/لا)`);
                        userState.set(userId, { step: `delete_auto_${key}_confirm`, delId: itemToDelete.id, delName: itemToDelete.name, timestamp: Date.now() });
                        return;
                    }

                    if (state.step === `delete_auto_${key}_confirm`) {
                        if (content.toLowerCase() === 'نعم') {
                            data.map.delete(state.delId);
                            data.save();
                            await client.sendMessage(userId, `✅ تم حذف "${state.delName}" بنجاح!`);
                        } else {
                            await client.sendMessage(userId, `❌ تم إلغاء الحذف.`);
                        }
                        userState.delete(userId);
                        return;
                    }
                }
            }
        }
    } catch (error) {
        console.error('[❌] Error in message handler:', error);
    }
});

// ============================================
// تشغيل البوت
// ============================================
console.log('[🚀] Starting WhatsApp Bot...');
client.initialize();
