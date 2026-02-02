const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const PdfPrinter = require('pdfmake');

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

// Bot state and data
const userState = new Map();
const groupsMetadata = new Map();
const blacklist = new Set();
const admins = new Set(['212715104027@c.us']);
const lectureStats = new Map();
const joinStats = new Map();
const leaveStats = new Map();
const messageStats = new Map();

// New data structures
const sections = new Map(); // الشعب
const classes = new Map(); // الفصول
const groupsData = new Map(); // الأفواج
const professors = new Map(); // الأساتذة
const subjects = new Map(); // المواد

let groupId = null;
let requestCount = 0;
let isBotReady = false;
const PDF_ARCHIVE_GROUP = '120363403563982270@g.us';
const IMAGES_ARCHIVE_GROUP = '120363400468776166@g.us';
const OWNER_ID = '212621957775@c.us';
const PROTECTION_PASSWORD = process.env.BOT_PASSWORD || 'your_secure_password';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY';

let lecturesMetadata = [];
const lecturesFile = './lectures.json';
const lecturesDir = './lectures/';
const statsFile = './stats.json';
const blacklistFile = './blacklist.json';

// New data files
const sectionsFile = './sections.json';
const classesFile = './classes.json';
const groupsFile = './groups.json';
const professorsFile = './professors.json';
const subjectsFile = './subjects.json';

if (!fs.existsSync(lecturesDir)) {
    fs.mkdirSync(lecturesDir);
}

// Load data from files
function loadLectures() {
    try {
        if (fs.existsSync(lecturesFile)) {
            const data = fs.readFileSync(lecturesFile, 'utf8');
            lecturesMetadata = data ? JSON.parse(data) : [];
            console.log(`[📂] Loaded ${lecturesMetadata.length} lectures`);
        } else {
            lecturesMetadata = [];
            fs.writeFileSync(lecturesFile, JSON.stringify([]));
        }
    } catch (error) {
        console.error('[❌] Error loading lectures:', error);
        lecturesMetadata = [];
        fs.writeFileSync(lecturesFile, JSON.stringify([]));
    }
}

function loadStats() {
    try {
        if (fs.existsSync(statsFile)) {
            const data = fs.readFileSync(statsFile, 'utf8');
            const stats = data ? JSON.parse(data) : {};
            joinStats.clear();
            leaveStats.clear();
            messageStats.clear();
            lectureStats.clear();
            for (const [groupId, joins] of Object.entries(stats.joins || {})) {
                joinStats.set(groupId, joins);
            }
            for (const [groupId, leaves] of Object.entries(stats.leaves || {})) {
                leaveStats.set(groupId, leaves);
            }
            for (const [groupId, messages] of Object.entries(stats.messages || {})) {
                messageStats.set(groupId, messages);
            }
            for (const [userId, lectures] of Object.entries(stats.lectures || {})) {
                lectureStats.set(userId, lectures);
            }
            console.log(`[📊] Loaded stats`);
        }
    } catch (error) {
        console.error('[❌] Error loading stats:', error);
    }
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
    } catch (error) {
        console.error('[❌] Error loading blacklist:', error);
    }
}

// New load functions
function loadSections() {
    try {
        if (fs.existsSync(sectionsFile)) {
            const data = fs.readFileSync(sectionsFile, 'utf8');
            const list = data ? JSON.parse(data) : [];
            sections.clear();
            list.forEach(item => sections.set(item.id, item.name));
            console.log(`[📂] Loaded ${sections.size} sections`);
        }
    } catch (error) {
        console.error('[❌] Error loading sections:', error);
    }
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
    } catch (error) {
        console.error('[❌] Error loading classes:', error);
    }
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
    } catch (error) {
        console.error('[❌] Error loading groups:', error);
    }
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
    } catch (error) {
        console.error('[❌] Error loading professors:', error);
    }
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
    } catch (error) {
        console.error('[❌] Error loading subjects:', error);
    }
}

function saveLectures() {
    try {
        fs.writeFileSync(lecturesFile, JSON.stringify(lecturesMetadata, null, 2));
        console.log('[💾] Saved lectures');
    } catch (error) {
        console.error('[❌] Error saving lectures:', error);
    }
}

function saveStats() {
    try {
        const stats = {
            joins: Object.fromEntries(joinStats),
            leaves: Object.fromEntries(leaveStats),
            messages: Object.fromEntries(messageStats),
            lectures: Object.fromEntries(lectureStats)
        };
        fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
        console.log('[💾] Saved stats');
    } catch (error) {
        console.error('[❌] Error saving stats:', error);
    }
}

function saveBlacklist() {
    try {
        fs.writeFileSync(blacklistFile, JSON.stringify([...blacklist]));
        console.log('[💾] Saved blacklist');
    } catch (error) {
        console.error('[❌] Error saving blacklist:', error);
    }
}

// New save functions
function saveSections() {
    try {
        const list = Array.from(sections.entries()).map(([id, name]) => ({ id, name }));
        fs.writeFileSync(sectionsFile, JSON.stringify(list, null, 2));
        console.log('[💾] Saved sections');
    } catch (error) {
        console.error('[❌] Error saving sections:', error);
    }
}

function saveClasses() {
    try {
        const list = Array.from(classes.entries()).map(([id, name]) => ({ id, name }));
        fs.writeFileSync(classesFile, JSON.stringify(list, null, 2));
        console.log('[💾] Saved classes');
    } catch (error) {
        console.error('[❌] Error saving classes:', error);
    }
}

function saveGroups() {
    try {
        const list = Array.from(groupsData.entries()).map(([id, name]) => ({ id, name }));
        fs.writeFileSync(groupsFile, JSON.stringify(list, null, 2));
        console.log('[💾] Saved groups');
    } catch (error) {
        console.error('[❌] Error saving groups:', error);
    }
}

function saveProfessors() {
    try {
        const list = Array.from(professors.entries()).map(([id, name]) => ({ id, name }));
        fs.writeFileSync(professorsFile, JSON.stringify(list, null, 2));
        console.log('[💾] Saved professors');
    } catch (error) {
        console.error('[❌] Error saving professors:', error);
    }
}

function saveSubjects() {
    try {
        const list = Array.from(subjects.entries()).map(([id, name]) => ({ id, name }));
        fs.writeFileSync(subjectsFile, JSON.stringify(list, null, 2));
        console.log('[💾] Saved subjects');
    } catch (error) {
        console.error('[❌] Error saving subjects:', error);
    }
}

loadLectures();
loadStats();
loadBlacklist();
loadSections();
loadClasses();
loadGroups();
loadProfessors();
loadSubjects();

const signature = "\n👨‍💻 *dev by: IRIZI 😊*";

// دالة للتواصل مع Gemini API
async function askGemini(prompt, context = '') {
    try {
        const fullPrompt = context ? `${context}\n\nالسؤال: ${prompt}` : prompt;
        
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                {
                                    text: fullPrompt
                                }
                            ]
                        }
                    ]
                })
            }
        );

        const data = await response.json();

        if (data && data.candidates && data.candidates.length > 0) {
            const text = data.candidates[0].content.parts[0].text;
            return text;
        } else {
            return "عذراً، لم أتمكن من الحصول على إجابة من الذكاء الاصطناعي.";
        }
    } catch (error) {
        console.error('[❌] Error calling Gemini API:', error);
        return "حدث خطأ أثناء الاتصال بالذكاء الاصطناعي.";
    }
}

// دالة لتحليل نية المستخدم باستخدام Gemini
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
            console.error('[❌] Error parsing AI response:', parseError);
            return {
                intent: "unknown",
                response: "عذراً، لم أفهم رسالتك. هل يمكنك توضيح ما تحتاجه؟",
                action: "none",
                confidence: 0.2
            };
        }
    } catch (error) {
        console.error('[❌] Error analyzing user intent:', error);
        return {
            intent: "unknown",
            response: "حدث خطأ أثناء معالجة رسالتك. يرجى المحاولة مرة أخرى لاحقاً.",
            action: "none",
            confidence: 0.1
        };
    }
}

// دالة لإنشاء رسائل ترحيب مخصصة باستخدام الذكاء الاصطناعي
async function generateWelcomeMessage(userName, groupName) {
    try {
        const context = `
أنت مساعد ذكاء اصطناعي لبوت WhatsApp. مهمتك هي إنشاء رسالة ترحيب دافئة وودية لعضو جديد في المجموعة.

المعلومات المتاحة:
- اسم العضو الجديد: ${userName}
- اسم المجموعة: ${groupName}

الرد يجب أن يكون رسالة ترحيب قصيرة ودافئة، لا تزيد عن 3 أسطر.
`;

        const aiResponse = await askGemini(`أنشئ رسالة ترحيب للعضو الجديد.`, context);
        return aiResponse;
    } catch (error) {
        console.error('[❌] Error generating welcome message:', error);
        return `مرحباً ${userName} في مجموعة ${groupName}! 🎉`;
    }
}

// دالة للتحقق من وجود الخطوط
function checkFonts() {
    const fontsDir = path.join(__dirname, 'fonts');
    const regularFont = path.join(fontsDir, 'Amiri-Regular.ttf');
    const boldFont = path.join(fontsDir, 'Amiri-Bold.ttf');
    
    if (!fs.existsSync(fontsDir)) {
        console.log('[❌] Fonts directory not found. Creating...');
        fs.mkdirSync(fontsDir);
        return false;
    }
    
    if (!fs.existsSync(regularFont)) {
        console.log('[❌] Amiri-Regular.ttf not found in fonts directory');
        return false;
    }
    
    if (!fs.existsSync(boldFont)) {
        console.log('[❌] Amiri-Bold.ttf not found in fonts directory');
        return false;
    }
    
    console.log('[✅] All fonts are available');
    return true;
}

// دالة لإنشاء جدول المحاضرات كملف PDF باستخدام pdfmake
async function generateLecturesTablePDF(lecturesData) {
    return new Promise((resolve, reject) => {
        try {
            console.log('[📊] Starting PDF generation...');
            console.log(`[📊] Number of lectures: ${lecturesData.length}`);
            
            // التحقق من وجود الخطوط
            if (!checkFonts()) {
                reject(new Error('الخطوط المطلوبة غير موجودة. يرجى التأكد من وجود ملفات Amiri-Regular.ttf و Amiri-Bold.ttf في مجلد fonts'));
                return;
            }

            // تعريف الخطوط
            const fonts = {
                Amiri: {
                    normal: path.join(__dirname, 'fonts/Amiri-Regular.ttf'),
                    bold: path.join(__dirname, 'fonts/Amiri-Bold.ttf'),
                }
            };

            console.log('[📊] Creating PDF printer...');
            const printer = new PdfPrinter(fonts);

            // إعداد الجدول
            console.log('[📊] Preparing table data...');
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
                const date = lecture.date
                    ? new Date(lecture.date).toLocaleDateString('ar-EG')
                    : 'غير محدد';

                body.push([
                    (index + 1).toString(),
                    lecture.subject || '',
                    lecture.lectureNumber || '',
                    lecture.professor || '',
                    lecture.groupNumber || '',
                    date
                ]);
            });

            console.log('[📊] Creating document definition...');
            const docDefinition = {
                defaultStyle: {
                    font: 'Amiri',
                    alignment: 'right', // محاذاة عربية
                    fontSize: 12
                },
                content: [
                    { text: 'جدول المحاضرات', style: 'header' },
                    { text: `تاريخ الإنشاء: ${new Date().toLocaleDateString('ar-EG')}`, alignment: 'left' },
                    {
                        table: {
                            headerRows: 1,
                            widths: ['auto', '*', 'auto', '*', 'auto', 'auto'],
                            body
                        },
                        layout: 'lightHorizontalLines'
                    },
                    { text: `إجمالي المحاضرات: ${lecturesData.length}`, margin: [0, 10, 0, 0] },
                    { text: 'تم إنشاء هذا الجدول باستخدام الذكاء الاصطناعي', alignment: 'center', fontSize: 10, color: 'gray' }
                ],
                styles: {
                    header: {
                        fontSize: 18,
                        bold: true,
                        alignment: 'center',
                        margin: [0, 0, 0, 10]
                    }
                },
                pageOrientation: 'landscape',
                pageSize: 'A4'
            };

            console.log('[📊] Creating PDF document...');
            const pdfDoc = printer.createPdfKitDocument(docDefinition);

            const chunks = [];
            pdfDoc.on('data', chunk => {
                chunks.push(chunk);
                console.log(`[📊] Received chunk: ${chunk.length} bytes`);
            });
            
            pdfDoc.on('end', () => {
                console.log('[📊] PDF generation completed');
                const buffer = Buffer.concat(chunks);
                console.log(`[📊] Final PDF size: ${buffer.length} bytes`);
                resolve(buffer);
            });
            
            pdfDoc.on('error', (error) => {
                console.error('[❌] PDF generation error:', error);
                reject(error);
            });
            
            pdfDoc.end();

        } catch (error) {
            console.error('[❌] Error in generateLecturesTablePDF:', error);
            reject(error);
        }
    });
}

// Utility functions
async function notifyAllGroups(messageText) {
    if (!isBotReady) return;
    
    try {
        const chats = await client.getChats();
        const groups = chats.filter(chat => chat.isGroup);
        for (const group of groups) {
            if (await isBotAdmin(group.id._serialized)) {
                await client.sendMessage(group.id._serialized, messageText + signature);
                console.log(`[📢] Sent to group: ${group.id._serialized}`);
            }
        }
    } catch (error) {
        console.error('[❌] Error notifying groups:', error);
    }
}

async function notifyAdmins(groupId, text) {
    if (!isBotReady) return;
    
    try {
        const chat = await client.getChatById(groupId);
        const admins = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
        for (const admin of admins) {
            await client.sendMessage(admin.id._serialized, `📢 *Admin Notification*\n${text}${signature}`);
        }
    } catch (error) {
        console.error('[❌] Error notifying admins:', error);
    }
}

async function isAdmin(userId, groupId) {
    if (!isBotReady) return false;
    
    try {
        // Owner is always admin
        if (userId === OWNER_ID) return true;
        
        const chat = await client.getChatById(groupId);
        if (!chat.isGroup) return false;
        
        // Check if user is in admins list
        if (admins.has(userId)) return true;
        
        // Check if user is group admin
        const groupAdmins = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
        return groupAdmins.some(admin => admin.id._serialized === userId);
    } catch (error) {
        console.error('[❌] Error checking admin status:', error);
        return false;
    }
}

async function isBotAdmin(groupId) {
    if (!isBotReady) return false;
    
    try {
        const chat = await client.getChatById(groupId);
        const botId = client.info.wid._serialized;
        const admins = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
        return admins.some(admin => admin.id._serialized === botId);
    } catch (error) {
        console.error('[❌] Error checking bot admin status:', error);
        return false;
    }
}

async function verifyGroup(groupId, groupName) {
    if (!isBotReady) return false;
    
    try {
        await client.getChatById(groupId);
        return true;
    } catch (error) {
        console.error(`[❌] Error: Group ${groupName} not found:`, error);
        return false;
    }
}

function formatPhoneNumber(number) {
    number = number.replace(/\D/g, '');
    if (!number.startsWith('+')) number = '+' + number;
    return number;
}

// Client events with enhanced debugging
client.on('qr', qr => {
    console.log('[📸] Scan QR code:');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('[✅] Authenticated successfully!');
});

client.on('auth_failure', msg => {
    console.error('[❌] Authentication failure:', msg);
    isBotReady = false;
});

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
        
        // Send test message to owner with delay
        setTimeout(async () => {
            try {
                if (isBotReady) {
                    await client.sendMessage(OWNER_ID, '✅ البوت يعمل الآن!' + signature);
                    console.log('[📤] Test message sent to owner');
                }
            } catch (error) {
                console.error('[❌] Error sending test message:', error);
            }
        }, 5000); // Wait 5 seconds before sending
    } catch (error) {
        console.error('[❌] Error in ready event:', error);
    }
});

client.on('disconnected', reason => {
    console.log('[❌] Client disconnected:', reason);
    isBotReady = false;
});

client.on('group_join', async (notification) => {
    if (!isBotReady) return;
    
    const groupId = notification.chatId;
    const userId = notification.id.participant;
    console.log(`[📢] User ${userId} joined ${groupId}`);
    
    if (blacklist.has(userId)) {
        if (await isBotAdmin(groupId)) {
            await client.removeParticipant(groupId, userId);
            console.log(`[📛] Removed blacklisted user ${userId}`);
        }
        return;
    }
    
    joinStats.set(groupId, joinStats.get(groupId) || []);
    joinStats.get(groupId).push({ userId, timestamp: Date.now() });
    saveStats();
    
    // Generate AI welcome message
    try {
        const contact = await client.getContactById(userId);
        const userName = contact.pushname || contact.name || "عضو جديد";
        const groupName = groupsMetadata.get(groupId) || "المجموعة";
        
        const welcomeMessage = await generateWelcomeMessage(userName, groupName);
        await client.sendMessage(groupId, welcomeMessage);
    } catch (error) {
        console.error('[❌] Error sending AI welcome message:', error);
    }
});

client.on('group_leave', async (notification) => {
    if (!isBotReady) return;
    
    const groupId = notification.chatId;
    const userId = notification.id.participant;
    console.log(`[📢] User ${userId} left ${groupId}`);
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

// Message handler with detailed debugging
client.on('message_create', async message => {
    try {
        if (!isBotReady) {
            console.log('[⚠️] Bot not ready, ignoring message');
            return;
        }
        
        console.log('=== NEW MESSAGE ===');
        console.log('From:', message.from);
        console.log('Body:', message.body);
        console.log('Author:', message.author);
        console.log('Is Group:', message.from.includes('@g.us'));
        
        if (!message || !message.from) {
            console.log('[⚠️] Invalid message, ignoring.');
            return;
        }

        const userId = message.from.includes('@g.us') ? message.author : message.from;
        console.log('Processed User ID:', userId);
        
        const contact = await message.getContact();
        const senderName = contact.pushname || contact.name || "User";
        const content = message.body && typeof message.body === 'string' ? message.body.trim() : '';
        const isGroupMessage = message.from.includes('@g.us');
        const currentGroupId = isGroupMessage ? message.from : groupId;
        const replyTo = isGroupMessage ? currentGroupId : userId;
        const groupName = isGroupMessage ? (groupsMetadata.get(currentGroupId) || "المجموعة") : "";

        console.log(`[📩] Message from ${senderName} (${userId}): ${content || '[non-text]'}`);

        // AI command - ask AI
        if (content.startsWith('!ask ')) {
            const question = content.substring(5).trim();
            if (!question) {
                await client.sendMessage(replyTo, `⚠️ يرجى كتابة سؤال بعد الأمر !ask${signature}`);
                return;
            }
            
            await message.react('🤖');
            await client.sendMessage(replyTo, `🤖 *جاري معالجة سؤالك...*`);
            
            try {
                const aiResponse = await askGemini(question);
                await client.sendMessage(replyTo, `${aiResponse}${signature}`);
            } catch (error) {
                console.error('[❌] Error in AI command:', error);
                await client.sendMessage(replyTo, `⚠️ حدث خطأ أثناء معالجة سؤالك. يرجى المحاولة مرة أخرى لاحقاً.${signature}`);
            }
            return;
        }

        // AI command - analyze intent
        if (content === '!analyze' || content === '!تحليل') {
            if (!isGroupMessage) {
                await client.sendMessage(replyTo, `⚠️ هذا الأمر يعمل في المجموعات فقط!${signature}`);
                return;
            }
            
            await message.react('🔍');
            await client.sendMessage(replyTo, `🔍 *جاري تحليل الرسائل الأخيرة...*`);
            
            try {
                // Get recent messages
                const chat = await client.getChatById(currentGroupId);
                const messages = await chat.fetchMessages({ limit: 10 });
                
                // Analyze each message
                for (const msg of messages.reverse()) {
                    if (msg.body && !msg.body.startsWith('!')) {
                        const msgContact = await msg.getContact();
                        const msgSenderName = msgContact.pushname || msgContact.name || "User";
                        
                        const analysis = await analyzeUserIntent(msg.body, msgSenderName, true, groupName);
                        
                        if (analysis.confidence > 0.7 && analysis.action !== 'none') {
                            // Take action based on analysis
                            if (analysis.action === 'notify_admin') {
                                await notifyAdmins(currentGroupId, `🔍 *تحليل ذكاء اصطناعي*\n\n${msgSenderName}: ${msg.body}\n\nالنية: ${analysis.intent}\nالرد المقترح: ${analysis.response}`);
                            }
                        }
                    }
                }
                
                await client.sendMessage(replyTo, `✅ *اكتمل تحليل الرسائل!*${signature}`);
            } catch (error) {
                console.error('[❌] Error in analyze command:', error);
                await client.sendMessage(replyTo, `⚠️ حدث خطأ أثناء تحليل الرسائل. يرجى المحاولة مرة أخرى لاحقاً.${signature}`);
            }
            return;
        }

        // AI command - generate content
        if (content.startsWith('!generate ')) {
            const prompt = content.substring(9).trim();
            if (!prompt) {
                await client.sendMessage(replyTo, `⚠️ يرجى كتابة وصف للمحتوى بعد الأمر !generate${signature}`);
                return;
            }
            
            await message.react('✍️');
            await client.sendMessage(replyTo, `✍️ *جاري إنشاء المحتوى...*`);
            
            try {
                const aiResponse = await askGemini(`أنشئ محتوى بناءً على الوصف التالي: ${prompt}`);
                await client.sendMessage(replyTo, `${aiResponse}${signature}`);
            } catch (error) {
                console.error('[❌] Error in generate command:', error);
                await client.sendMessage(replyTo, `⚠️ حدث خطأ أثناء إنشاء المحتوى. يرجى المحاولة مرة أخرى لاحقاً.${signature}`);
            }
            return;
        }

        // Command to generate lectures table PDF
        if (content === '!جدول_المحاضرات' || content === '!lectures_table') {
            await message.react('📊');
            await client.sendMessage(replyTo, `📊 *جاري إنشاء جدول المحاضرات باستخدام pdfmake...*`);
            
            try {
                console.log(`[📊] User requested lectures table. Current lectures count: ${lecturesMetadata.length}`);
                
                if (lecturesMetadata.length === 0) {
                    await client.sendMessage(replyTo, `⚠️ لا توجد محاضرات مضافة بعد!${signature}`);
                    await message.react('❌');
                    return;
                }
                
                const pdfBuffer = await generateLecturesTablePDF(lecturesMetadata);
                
                // Create Media object from buffer
                const media = new MessageMedia(
                    'application/pdf',
                    pdfBuffer.toString('base64'),
                    `جدول_المحاضرات_${new Date().toISOString().split('T')[0]}.pdf`
                );
                
                await client.sendMessage(replyTo, media, {
                    caption: `📊 *جدول المحاضرات*\n\nتم إنشاء الجدول باستخدام pdfmake!\n📅 التاريخ: ${new Date().toLocaleDateString('ar-EG')}\n📝 عدد المحاضرات: ${lecturesMetadata.length}\n تم إنشاؤه بواسطة IRIZI${signature}`
                });
                
                await message.react('✅');
                console.log('[✅] Lectures table sent successfully');
            } catch (error) {
                console.error('[❌] Error generating lectures table:', error);
                await client.sendMessage(replyTo, `⚠️ حدث خطأ أثناء إنشاء جدول المحاضرات: ${error.message}${signature}`);
                await message.react('❌');
            }
            
            return;
        }

        // Pin message command
        if (isGroupMessage && content === '!تثبيت' && message.hasQuotedMsg) {
            if (await isAdmin(userId, currentGroupId)) {
                if (await isBotAdmin(currentGroupId)) {
                    const quotedMsg = await message.getQuotedMessage();
                    await quotedMsg.pin();
                    await client.sendMessage(OWNER_ID, `✅ Pinned message in ${currentGroupId}${signature}`);
                } else {
                    await client.sendMessage(OWNER_ID, `⚠️ I'm not an admin in ${currentGroupId}!${signature}`);
                }
            }
            return;
        }

        // Add PDF command - متاح لجميع أعضاء المجموعة
        if (content === '!اضافة_pdf' || content === '!add pdf') {
            if (isGroupMessage) {
                // التحقق من وجود بيانات
                if (sections.size === 0 || classes.size === 0 || groupsData.size === 0 || 
                    professors.size === 0 || subjects.size === 0) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ لم يتم إعداد بيانات الشعب أو الفصول أو الأفواج أو الأساتذة أو المواد بعد!${signature}`);
                    return;
                }
                
                await message.react('📄');
                await client.sendMessage(replyTo, `
📄 *إضافة ملف PDF*
مرحباً ${senderName}! 🙋‍♂️
يرجى اختيار نوع الملف:
1. محاضرة
2. ملخص

💡 أرسل رقم الخيار أو *إلغاء* للخروج${signature}`);
                userState.set(userId, { 
                    step: 'select_pdf_type', 
                    timestamp: Date.now() 
                });
            } else {
                await message.react('⚠️');
                await client.sendMessage(replyTo, `⚠️ هذا الأمر يعمل في المجموعات فقط!${signature}`);
            }
            return;
        }

        // Download PDF command - متاح لجميع أعضاء المجموعة
        if (content === '!تحميل' || content === '!download') {
            if (isGroupMessage) {
                // التحقق من وجود بيانات
                if (sections.size === 0 || classes.size === 0 || groupsData.size === 0 || 
                    professors.size === 0 || subjects.size === 0) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ لم يتم إعداد بيانات الشعب أو الفصول أو الأفواج أو الأساتذة أو المواد بعد!${signature}`);
                    return;
                }
                
                await message.react('📥');
                await client.sendMessage(replyTo, `
📥 *تحميل ملف PDF*
مرحباً ${senderName}! 🙋‍♂️
يرجى اختيار نوع الملف:
1. محاضرة
2. ملخص

💡 أرسل رقم الخيار أو *إلغاء* للخروج${signature}`);
                userState.set(userId, { 
                    step: 'select_pdf_type_for_download', 
                    timestamp: Date.now() 
                });
            } else {
                await message.react('⚠️');
                await client.sendMessage(replyTo, `⚠️ هذا الأمر يعمل في المجموعات فقط!${signature}`);
            }
            return;
        }

        // Admin panel
        if (!isGroupMessage && userId === OWNER_ID && content === '!إدارة') {
            await message.react('👨‍💻');
            await client.sendMessage(userId, `
👨‍💻 *لوحة الإدارة*
اختر العملية:
1. إضافة عضو/أعضاء
2. حذف عضو
3. ترقية عضو لمشرف
4. خفض مشرف
5. إضافة مبرمج
6. حذف مبرمج
7. تنظيف المجموعة
8. تثبيت رسالة
9. إحصائيات المجموعات
10. تحفيز المستخدمين
11. تحليل ذكاء اصطناعي
12. إنشاء محتوى
13. جدول المحاضرات (pdfmake)
14. إدارة المحاضرات
15. إدارة الشعب
16. إدارة الفصول
17. إدارة الأفواج
18. إدارة الأساتذة
19. إدارة المواد
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
            userState.set(userId, { step: 'admin_menu', timestamp: Date.now() });
            return;
        }

        // Handle PDF upload process
        if (userState.has(userId)) {
            const state = userState.get(userId);

            // Cancel command
            if (content.toLowerCase() === 'إلغاء') {
                await message.react('❌');
                await client.sendMessage(replyTo, `✅ تم الإلغاء!${signature}`);
                userState.delete(userId);
                return;
            }

            // Step: Select PDF type
            if (state.step === 'select_pdf_type') {
                const option = parseInt(content);
                if (isNaN(option) || (option !== 1 && option !== 2)) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار 1 للمحاضرة أو 2 للملخص.${signature}`);
                    return;
                }
                
                const pdfType = option === 1 ? 'محاضرة' : 'ملخص';
                
                // Update state
                state.pdfType = pdfType;
                state.step = 'select_section';
                userState.set(userId, state);
                
                // Show sections
                let sectionsList = `📚 *اختر الشعبة*\n\n`;
                let index = 1;
                for (const [id, name] of sections) {
                    sectionsList += `${index}. ${name}\n`;
                    index++;
                }
                sectionsList += `\n💡 أرسل رقم الشعبة أو *إلغاء* للخروج${signature}`;
                await client.sendMessage(replyTo, sectionsList);
                return;
            }

            // Step: Select section
            if (state.step === 'select_section') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > sections.size) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الشعبة الصحيح.${signature}`);
                    return;
                }
                
                // Get section ID and name
                const sectionId = Array.from(sections.keys())[option - 1];
                const sectionName = sections.get(sectionId);
                
                // Update state
                state.sectionId = sectionId;
                state.sectionName = sectionName;
                state.step = 'select_class';
                userState.set(userId, state);
                
                // Show classes
                let classesList = `🏫 *اختر الفصل*\n\n`;
                let index = 1;
                for (const [id, name] of classes) {
                    classesList += `${index}. ${name}\n`;
                    index++;
                }
                classesList += `\n💡 أرسل رقم الفصل أو *إلغاء* للخروج${signature}`;
                await client.sendMessage(replyTo, classesList);
                return;
            }

            // Step: Select class
            if (state.step === 'select_class') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > classes.size) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الفصل الصحيح.${signature}`);
                    return;
                }
                
                // Get class ID and name
                const classId = Array.from(classes.keys())[option - 1];
                const className = classes.get(classId);
                
                // Update state
                state.classId = classId;
                state.className = className;
                state.step = 'select_group';
                userState.set(userId, state);
                
                // Show groups
                let groupsList = `👥 *اختر الفوج*\n\n`;
                let index = 1;
                for (const [id, name] of groupsData) {
                    groupsList += `${index}. ${name}\n`;
                    index++;
                }
                groupsList += `\n💡 أرسل رقم الفوج أو *إلغاء* للخروج${signature}`;
                await client.sendMessage(replyTo, groupsList);
                return;
            }

            // Step: Select group
            if (state.step === 'select_group') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > groupsData.size) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الفوج الصحيح.${signature}`);
                    return;
                }
                
                // Get group ID and name
                const groupId = Array.from(groupsData.keys())[option - 1];
                const groupName = groupsData.get(groupId);
                
                // Update state
                state.groupId = groupId;
                state.groupName = groupName;
                state.step = 'select_professor';
                userState.set(userId, state);
                
                // Show professors
                let professorsList = `👨‍🏫 *اختر الأستاذ*\n\n`;
                let index = 1;
                for (const [id, name] of professors) {
                    professorsList += `${index}. ${name}\n`;
                    index++;
                }
                professorsList += `\n💡 أرسل رقم الأستاذ أو *إلغاء* للخروج${signature}`;
                await client.sendMessage(replyTo, professorsList);
                return;
            }

            // Step: Select professor
            if (state.step === 'select_professor') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > professors.size) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الأستاذ الصحيح.${signature}`);
                    return;
                }
                
                // Get professor ID and name
                const professorId = Array.from(professors.keys())[option - 1];
                const professorName = professors.get(professorId);
                
                // Update state
                state.professorId = professorId;
                state.professorName = professorName;
                state.step = 'select_subject';
                userState.set(userId, state);
                
                // Show subjects
                let subjectsList = `📖 *اختر المادة*\n\n`;
                let index = 1;
                for (const [id, name] of subjects) {
                    subjectsList += `${index}. ${name}\n`;
                    index++;
                }
                subjectsList += `\n💡 أرسل رقم المادة أو *إلغاء* للخروج${signature}`;
                await client.sendMessage(replyTo, subjectsList);
                return;
            }

            // Step: Select subject
            if (state.step === 'select_subject') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > subjects.size) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم المادة الصحيح.${signature}`);
                    return;
                }
                
                // Get subject ID and name
                const subjectId = Array.from(subjects.keys())[option - 1];
                const subjectName = subjects.get(subjectId);
                
                // Update state
                state.subjectId = subjectId;
                state.subjectName = subjectName;
                state.step = 'enter_lecture_number';
                userState.set(userId, state);
                
                // Ask for lecture number
                await client.sendMessage(replyTo, `
📝 *أدخل رقم ${state.pdfType}*
يرجى إدخال رقم ${state.pdfType}:
💡 أرسل *إلغاء* للخروج${signature}`);
                return;
            }

            // Step: Enter lecture number
            if (state.step === 'enter_lecture_number') {
                const lectureNumber = content.trim();
                if (!lectureNumber) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ يرجى إدخال رقم ${state.pdfType}!${signature}`);
                    return;
                }
                
                // Update state
                state.lectureNumber = lectureNumber;
                state.step = 'waiting_pdf';
                userState.set(userId, state);
                
                // Ask for PDF file
                await client.sendMessage(replyTo, `
📄 *إرسال ملف PDF*
الآن يرجى إرسال ملف PDF لـ ${state.pdfType}:
📖 المادة: ${state.subjectName}
📝 رقم ${state.pdfType}: ${state.lectureNumber}
👨‍🏫 الأستاذ: ${state.professorName}
👥 الفوج: ${state.groupName}
🏫 الفصل: ${state.className}
📚 الشعبة: ${state.sectionName}

💡 أرسل *إلغاء* للخروج${signature}`);
                return;
            }

            // Step 1: Waiting for PDF file
            if (state.step === 'waiting_pdf') {
                if (message.hasMedia && message.type === 'document') {
                    const media = await message.downloadMedia();
                    if (media.mimetype === 'application/pdf') {
                        // Store PDF data in state
                        state.pdfData = {
                            data: media.data,
                            mimetype: media.mimetype,
                            filename: media.filename || `${state.pdfType}.pdf`
                        };
                        state.step = 'confirm_pdf';
                        userState.set(userId, state);
                        
                        // Show confirmation
                        await message.react('✅');
                        await client.sendMessage(replyTo, `
✅ *تأكيد إضافة ${state.pdfType}*
يرجى مراجعة البيانات والتأكيد:

📖 *المادة:* ${state.subjectName}
📝 *رقم ${state.pdfType}:* ${state.lectureNumber}
👨‍🏫 *الأستاذ:* ${state.professorName}
👥 *الفوج:* ${state.groupName}
🏫 *الفصل:* ${state.className}
📚 *الشعبة:* ${state.sectionName}
📄 *اسم الملف:* ${state.pdfData.filename}

هل تريد إضافة هذا ${state.pdfType}؟
أرسل *نعم* للتأكيد أو *لا* للتعديل${signature}`);
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

            // Step: Confirm PDF
            if (state.step === 'confirm_pdf') {
                if (content.toLowerCase() === 'نعم') {
                    try {
                        // Create media object
                        const media = new MessageMedia(
                            state.pdfData.mimetype,
                            state.pdfData.data,
                            state.pdfData.filename
                        );

                        // Create formatted message
                        const caption = `
📚 *${state.pdfType} جديد*

📖 *المادة:* ${state.subjectName}
📝 *رقم ${state.pdfType}:* ${state.lectureNumber}
👨‍🏫 *الأستاذ:* ${state.professorName}
👥 *الفوج:* ${state.groupName}
🏫 *الفصل:* ${state.className}
📚 *الشعبة:* ${state.sectionName}
👤 *أضيف بواسطة:* ${senderName}

📅 *تاريخ الإضافة:* ${new Date().toLocaleDateString('ar-EG')}
${signature}`;

                        // Send to PDF archive group
                        await client.sendMessage(PDF_ARCHIVE_GROUP, media, { caption });
                        
                        // Add to lectures metadata
                        lecturesMetadata.push({
                            type: state.pdfType,
                            subject: state.subjectName,
                            subjectId: state.subjectId,
                            lectureNumber: state.lectureNumber,
                            professor: state.professorName,
                            professorId: state.professorId,
                            groupNumber: state.groupName,
                            groupId: state.groupId,
                            className: state.className,
                            classId: state.classId,
                            sectionName: state.sectionName,
                            sectionId: state.sectionId,
                            date: new Date().toISOString(),
                            addedBy: userId,
                            fileName: state.pdfData.filename
                        });
                        saveLectures();
                        
                        // Send confirmation to user
                        await message.react('✅');
                        await client.sendMessage(replyTo, `
✅ *تمت إضافة ${state.pdfType} بنجاح!*
شكراً ${senderName}! 🙏
تم إرسال الملف والمعلومات إلى مجموعة الأرشيف.${signature}`);

                        // Update lecture statistics
                        lectureStats.set(userId, lectureStats.get(userId) || []);
                        lectureStats.get(userId).push({
                            name: `${state.subjectName} - ${state.pdfType} ${state.lectureNumber}`,
                            timestamp: Date.now()
                        });
                        saveStats();

                        // Clear user state
                        userState.delete(userId);
                    } catch (error) {
                        console.error('[❌] Error sending PDF to archive:', error);
                        await message.react('❌');
                        await client.sendMessage(replyTo, `⚠️ حدث خطأ أثناء إرسال الملف!${signature}`);
                        userState.delete(userId);
                    }
                } else if (content.toLowerCase() === 'لا') {
                    // Go back to lecture number step
                    state.step = 'enter_lecture_number';
                    userState.set(userId, state);
                    
                    await client.sendMessage(replyTo, `
📝 *تعديل رقم ${state.pdfType}*
يرجى إدخال رقم ${state.pdfType} جديد:
💡 أرسل *إلغاء* للخروج${signature}`);
                } else {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ يرجى إرسال *نعم* للتأكيد أو *لا* للتعديل!${signature}`);
                }
                return;
            }

            // Step: Select PDF type for download
            if (state.step === 'select_pdf_type_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || (option !== 1 && option !== 2)) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار 1 للمحاضرة أو 2 للملخص.${signature}`);
                    return;
                }
                
                const pdfType = option === 1 ? 'محاضرة' : 'ملخص';
                
                // Update state
                state.pdfType = pdfType;
                state.step = 'select_search_method';
                userState.set(userId, state);
                
                // Show search methods
                await client.sendMessage(replyTo, `
📥 *تحميل ${pdfType}*
اختر طريقة البحث:
1. عرض الكل
2. تصفية حسب الشعبة، الفصل، الفوج، الأستاذ، المادة

💡 أرسل رقم الخيار أو *إلغاء* للخروج${signature}`);
                return;
            }

            // Step: Select search method
            if (state.step === 'select_search_method') {
                const option = parseInt(content);
                if (isNaN(option) || (option !== 1 && option !== 2)) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار 1 أو 2.${signature}`);
                    return;
                }
                
                if (option === 1) {
                    // عرض الكل
                    const filteredLectures = lecturesMetadata.filter(lecture => lecture.type === state.pdfType);
                    
                    if (filteredLectures.length === 0) {
                        await client.sendMessage(replyTo, `⚠️ لا توجد ${state.pdfType} مضافة بعد!${signature}`);
                        userState.delete(userId);
                        return;
                    }
                    
                    let lecturesList = `📄 *قائمة ${state.pdfType}*\n\n`;
                    filteredLectures.forEach((lecture, index) => {
                        lecturesList += `${index + 1}. ${lecture.subject} - ${state.pdfType} ${lecture.lectureNumber}\n`;
                        lecturesList += `   👨‍🏫 الأستاذ: ${lecture.professor}\n`;
                        lecturesList += `   👥 الفوج: ${lecture.groupNumber}\n`;
                        lecturesList += `   🏫 الفصل: ${lecture.className}\n`;
                        lecturesList += `   📚 الشعبة: ${lecture.sectionName}\n`;
                        lecturesList += `   📅 التاريخ: ${new Date(lecture.date).toLocaleDateString('ar-EG')}\n\n`;
                    });
                    lecturesList += `\n💡 أرسل رقم ${state.pdfType} التي تريد تحميلها أو *إلغاء* للخروج${signature}`;
                    
                    // Store lectures for download
                    state.availableLectures = filteredLectures;
                    state.step = 'select_lecture_for_download';
                    userState.set(userId, state);
                    
                    await client.sendMessage(replyTo, lecturesList);
                } else {
                    // تصفية
                    state.step = 'select_section_for_download';
                    userState.set(userId, state);
                    
                    // Show sections
                    let sectionsList = `📚 *اختر الشعبة*\n\n`;
                    let index = 1;
                    for (const [id, name] of sections) {
                        sectionsList += `${index}. ${name}\n`;
                        index++;
                    }
                    sectionsList += `\n💡 أرسل رقم الشعبة أو *إلغاء* للخروج${signature}`;
                    await client.sendMessage(replyTo, sectionsList);
                }
                return;
            }

            // Step: Select section for download
            if (state.step === 'select_section_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > sections.size) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الشعبة الصحيح.${signature}`);
                    return;
                }
                
                // Get section ID and name
                const sectionId = Array.from(sections.keys())[option - 1];
                const sectionName = sections.get(sectionId);
                
                // Update state
                state.sectionId = sectionId;
                state.sectionName = sectionName;
                state.step = 'select_class_for_download';
                userState.set(userId, state);
                
                // Show classes
                let classesList = `🏫 *اختر الفصل*\n\n`;
                let index = 1;
                for (const [id, name] of classes) {
                    classesList += `${index}. ${name}\n`;
                    index++;
                }
                classesList += `\n💡 أرسل رقم الفصل أو *إلغاء* للخروج${signature}`;
                await client.sendMessage(replyTo, classesList);
                return;
            }

            // Step: Select class for download
            if (state.step === 'select_class_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > classes.size) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الفصل الصحيح.${signature}`);
                    return;
                }
                
                // Get class ID and name
                const classId = Array.from(classes.keys())[option - 1];
                const className = classes.get(classId);
                
                // Update state
                state.classId = classId;
                state.className = className;
                state.step = 'select_group_for_download';
                userState.set(userId, state);
                
                // Show groups
                let groupsList = `👥 *اختر الفوج*\n\n`;
                let index = 1;
                for (const [id, name] of groupsData) {
                    groupsList += `${index}. ${name}\n`;
                    index++;
                }
                groupsList += `\n💡 أرسل رقم الفوج أو *إلغاء* للخروج${signature}`;
                await client.sendMessage(replyTo, groupsList);
                return;
            }

            // Step: Select group for download
            if (state.step === 'select_group_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > groupsData.size) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الفوج الصحيح.${signature}`);
                    return;
                }
                
                // Get group ID and name
                const groupId = Array.from(groupsData.keys())[option - 1];
                const groupName = groupsData.get(groupId);
                
                // Update state
                state.groupId = groupId;
                state.groupName = groupName;
                state.step = 'select_professor_for_download';
                userState.set(userId, state);
                
                // Show professors
                let professorsList = `👨‍🏫 *اختر الأستاذ*\n\n`;
                let index = 1;
                for (const [id, name] of professors) {
                    professorsList += `${index}. ${name}\n`;
                    index++;
                }
                professorsList += `\n💡 أرسل رقم الأستاذ أو *إلغاء* للخروج${signature}`;
                await client.sendMessage(replyTo, professorsList);
                return;
            }

            // Step: Select professor for download
            if (state.step === 'select_professor_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > professors.size) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الأستاذ الصحيح.${signature}`);
                    return;
                }
                
                // Get professor ID and name
                const professorId = Array.from(professors.keys())[option - 1];
                const professorName = professors.get(professorId);
                
                // Update state
                state.professorId = professorId;
                state.professorName = professorName;
                state.step = 'select_subject_for_download';
                userState.set(userId, state);
                
                // Show subjects
                let subjectsList = `📖 *اختر المادة*\n\n`;
                let index = 1;
                for (const [id, name] of subjects) {
                    subjectsList += `${index}. ${name}\n`;
                    index++;
                }
                subjectsList += `\n💡 أرسل رقم المادة أو *إلغاء* للخروج${signature}`;
                await client.sendMessage(replyTo, subjectsList);
                return;
            }

            // Step: Select subject for download
            if (state.step === 'select_subject_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > subjects.size) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم المادة الصحيح.${signature}`);
                    return;
                }
                
                // Get subject ID and name
                const subjectId = Array.from(subjects.keys())[option - 1];
                const subjectName = subjects.get(subjectId);
                
                // Filter lectures
                const filteredLectures = lecturesMetadata.filter(lecture => 
                    lecture.type === state.pdfType &&
                    lecture.sectionId === state.sectionId &&
                    lecture.classId === state.classId &&
                    lecture.groupId === state.groupId &&
                    lecture.professorId === state.professorId &&
                    lecture.subjectId === state.subjectId
                );
                
                if (filteredLectures.length === 0) {
                    await client.sendMessage(replyTo, `⚠️ لا توجد ${state.pdfType} لهذه المادة في هذا التصفية!${signature}`);
                    userState.delete(userId);
                    return;
                }
                
                let lecturesList = `📄 *قائمة ${state.pdfType} للمادة: ${subjectName}*\n\n`;
                filteredLectures.forEach((lecture, index) => {
                    lecturesList += `${index + 1}. ${state.pdfType} ${lecture.lectureNumber}\n`;
                    lecturesList += `   👨‍🏫 الأستاذ: ${lecture.professor}\n`;
                    lecturesList += `   👥 الفوج: ${lecture.groupNumber}\n`;
                    lecturesList += `   🏫 الفصل: ${lecture.className}\n`;
                    lecturesList += `   📚 الشعبة: ${lecture.sectionName}\n`;
                    lecturesList += `   📅 التاريخ: ${new Date(lecture.date).toLocaleDateString('ar-EG')}\n\n`;
                });
                lecturesList += `\n💡 أرسل رقم ${state.pdfType} التي تريد تحميلها أو *إلغاء* للخروج${signature}`;
                
                // Store lectures for download
                state.availableLectures = filteredLectures;
                state.step = 'select_lecture_for_download';
                userState.set(userId, state);
                
                await client.sendMessage(replyTo, lecturesList);
                return;
            }

            // Step: Select lecture for download
            if (state.step === 'select_lecture_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > state.availableLectures.length) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم ${state.pdfType} الصحيح.${signature}`);
                    return;
                }
                
                const selectedLecture = state.availableLectures[option - 1];
                
                await message.react('📥');
                await client.sendMessage(replyTo, `📥 *جاري تحميل ${state.pdfType}...*\n\n${selectedLecture.subject} - ${state.pdfType} ${selectedLecture.lectureNumber}`);
                
                try {
                    // Get the PDF from the archive group
                    const archiveChat = await client.getChatById(PDF_ARCHIVE_GROUP);
                    const messages = await archiveChat.fetchMessages({ limit: 100 });
                    
                    // Find the message with the selected lecture
                    let targetMessage = null;
                    for (const msg of messages) {
                        if (msg.hasMedia && msg.type === 'document') {
                            const caption = msg.body || '';
                            if (caption.includes(selectedLecture.subject) && 
                                caption.includes(`${state.pdfType} ${selectedLecture.lectureNumber}`) &&
                                caption.includes(selectedLecture.professor)) {
                                targetMessage = msg;
                                break;
                            }
                        }
                    }
                    
                    if (targetMessage) {
                        // Forward the message to the user
                        await targetMessage.forward(replyTo);
                        
                        await client.sendMessage(replyTo, `
✅ *تم تحميل ${state.pdfType} بنجاح!*
📖 المادة: ${selectedLecture.subject}
📝 رقم ${state.pdfType}: ${selectedLecture.lectureNumber}
👨‍🏫 الأستاذ: ${selectedLecture.professor}
👥 الفوج: ${selectedLecture.groupNumber}
🏫 الفصل: ${selectedLecture.className}
📚 الشعبة: ${selectedLecture.sectionName}
${signature}`);
                    } else {
                        await client.sendMessage(replyTo, `⚠️ لم يتم العثور على ملف ${state.pdfType} في الأرشيف!${signature}`);
                    }
                    
                    userState.delete(userId);
                } catch (error) {
                    console.error('[❌] Error downloading lecture:', error);
                    await client.sendMessage(replyTo, `⚠️ حدث خطأ أثناء تحميل ${state.pdfType}: ${error.message}${signature}`);
                    userState.delete(userId);
                }
                return;
            }
        }

        // Handle admin panel steps
        if (userState.has(userId) && userId === OWNER_ID) {
            const state = userState.get(userId);

            if (content.toLowerCase() === 'إلغاء') {
                await message.react('❌');
                await client.sendMessage(userId, `✅ تم الإلغاء!${signature}`);
                userState.delete(userId);
                return;
            }

            if (state.step === 'admin_menu') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 19) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح! جرب تاني.${signature}`);
                    return;
                }

                if (option === 8) {
                    await message.react('📌');
                    await client.sendMessage(userId, `
📌 *تثبيت رسالة*
في المجموعة، اعمل ريبلي للرسالة اللي عايز تثبتها واكتب:
!تثبيت
💡 أرسل *إلغاء* لو غيرت رأيك${signature}`);
                    userState.delete(userId);
                    return;
                }

                if (option === 10) {
                    await message.react('🎉');
                    await client.sendMessage(userId, `✅ تم تفعيل التحفيز التلقائي!${signature}`);
                    userState.delete(userId);
                    return;
                }

                if (option === 9) {
                    await message.react('📊');
                    await client.sendMessage(userId, `
📊 *إحصائيات المجموعات*
اختر نوع الإحصائيات:
1. الأعضاء المنضمين
2. الأعضاء اللي غادروا/حُذفوا
3. نشاط الرسايل
4. المحاضرات المضافة
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                    userState.set(userId, { step: 'stats_menu', timestamp: Date.now() });
                    return;
                }

                if (option === 11) {
                    await message.react('🤖');
                    await client.sendMessage(userId, `
🤖 *تحليل ذكاء اصطناعي*
اختر المجموعة للتحليل:
1. جميع المجموعات
2. مجموعة محددة
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                    userState.set(userId, { step: 'ai_analysis_select', timestamp: Date.now() });
                    return;
                }

                if (option === 12) {
                    await message.react('✍️');
                    await client.sendMessage(userId, `
✍️ *إنشاء محتوى*
أرسل وصف المحتوى الذي تريد إنشاءه:
💡 أرسل *إلغاء* للخروج${signature}`);
                    userState.set(userId, { step: 'ai_generate_content', timestamp: Date.now() });
                    return;
                }

                if (option === 13) {
                    await message.react('📊');
                    await client.sendMessage(userId, `📊 *جاري إنشاء جدول المحاضرات باستخدام pdfmake...*`);
                    
                    try {
                        console.log(`[📊] Admin requested lectures table. Current lectures count: ${lecturesMetadata.length}`);
                        
                        if (lecturesMetadata.length === 0) {
                            await client.sendMessage(userId, `⚠️ لا توجد محاضرات مضافة بعد!${signature}`);
                            await message.react('❌');
                            userState.delete(userId);
                            return;
                        }
                        
                        const pdfBuffer = await generateLecturesTablePDF(lecturesMetadata);
                        
                        // Create Media object from buffer
                        const media = new MessageMedia(
                            'application/pdf',
                            pdfBuffer.toString('base64'),
                            `جدول_المحاضرات_${new Date().toISOString().split('T')[0]}.pdf`
                        );
                        
                        await client.sendMessage(userId, media, {
                            caption: `📊 *جدول المحاضرات*\n\nتم إنشاء الجدول باستخدام pdfmake!\n📅 التاريخ: ${new Date().toLocaleDateString('ar-EG')}\n📝 عدد المحاضرات: ${lecturesMetadata.length}\n🤖 تم إنشاؤه بواسطة Gemini AI${signature}`
                        });
                        
                        await message.react('✅');
                        console.log('[✅] Lectures table sent to admin successfully');
                    } catch (error) {
                        console.error('[❌] Error generating lectures table for admin:', error);
                        await client.sendMessage(userId, `⚠️ حدث خطأ أثناء إنشاء جدول المحاضرات: ${error.message}${signature}`);
                        await message.react('❌');
                    }
                    
                    userState.delete(userId);
                    return;
                }

                if (option === 14) {
                    await message.react('📚');
                    await client.sendMessage(userId, `
📚 *إدارة المحاضرات*
اختر العملية:
1. عرض جميع المحاضرات
2. تعديل محاضرة
3. حذف محاضرة
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                    userState.set(userId, { step: 'lectures_management_menu', timestamp: Date.now() });
                    return;
                }

                // إدارة الشعب
                if (option === 15) {
                    await message.react('📚');
                    await client.sendMessage(userId, `
📚 *إدارة الشعب*
اختر العملية:
1. عرض جميع الشعب
2. إضافة شعبة
3. تعديل شعبة
4. حذف شعبة
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                    userState.set(userId, { step: 'sections_management_menu', timestamp: Date.now() });
                    return;
                }

                // إدارة الفصول
                if (option === 16) {
                    await message.react('🏫');
                    await client.sendMessage(userId, `
🏫 *إدارة الفصول*
اختر العملية:
1. عرض جميع الفصول
2. إضافة فصل
3. تعديل فصل
4. حذف فصل
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                    userState.set(userId, { step: 'classes_management_menu', timestamp: Date.now() });
                    return;
                }

                // إدارة الأفواج
                if (option === 17) {
                    await message.react('👥');
                    await client.sendMessage(userId, `
👥 *إدارة الأفواج*
اختر العملية:
1. عرض جميع الأفواج
2. إضافة فوج
3. تعديل فوج
4. حذف فوج
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                    userState.set(userId, { step: 'groups_management_menu', timestamp: Date.now() });
                    return;
                }

                // إدارة الأساتذة
                if (option === 18) {
                    await message.react('👨‍🏫');
                    await client.sendMessage(userId, `
👨‍🏫 *إدارة الأساتذة*
اختر العملية:
1. عرض جميع الأساتذة
2. إضافة أستاذ
3. تعديل أستاذ
4. حذف أستاذ
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                    userState.set(userId, { step: 'professors_management_menu', timestamp: Date.now() });
                    return;
                }

                // إدارة المواد
                if (option === 19) {
                    await message.react('📖');
                    await client.sendMessage(userId, `
📖 *إدارة المواد*
اختر العملية:
1. عرض جميع المواد
2. إضافة مادة
3. تعديل مادة
4. حذف مادة
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                    userState.set(userId, { step: 'subjects_management_menu', timestamp: Date.now() });
                    return;
                }

                await message.react('📋');
                let groupList = `📋 *اختر المجموعة*\n`;
                let index = 1;
                for (const [id, name] of groupsMetadata) {
                    groupList += `${index}. ${name} (${id})\n`;
                    index++;
                }
                groupList += `💡 أرسل رقم المجموعة أو *إلغاء*${signature}`;
                await client.sendMessage(userId, groupList);
                userState.set(userId, { step: `admin_option_${option}_select_group`, timestamp: Date.now() });
                return;
            }

            // Handle sections management
            if (state.step === 'sections_management_menu') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 4) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }
                
                if (option === 1) {
                    await message.react('📋');
                    let sectionsList = `📋 *جميع الشعب*\n\n`;
                    if (sections.size === 0) {
                        sectionsList += `⚠️ لا توجد شعب مضافة بعد!\n`;
                    } else {
                        sections.forEach((name, id) => {
                            sectionsList += `${id}. ${name}\n`;
                        });
                    }
                    sectionsList += `💡 إجمالي: ${sections.size} شعبة${signature}`;
                    await client.sendMessage(userId, sectionsList);
                    userState.delete(userId);
                    return;
                }
                
                if (option === 2) {
                    await message.react('➕');
                    await client.sendMessage(userId, `
➕ *إضافة شعبة جديدة*
أرسل اسم الشعبة الجديدة:
💡 أرسل *إلغاء* للخروج${signature}`);
                    userState.set(userId, { step: 'add_section', timestamp: Date.now() });
                    return;
                }
                
                if (option === 3) {
                    await message.react('✏️');
                    let sectionsList = `✏️ *اختر شعبة للتعديل*\n\n`;
                    if (sections.size === 0) {
                        sectionsList += `⚠️ لا توجد شعب مضافة بعد!\n`;
                    } else {
                        sections.forEach((name, id) => {
                            sectionsList += `${id}. ${name}\n`;
                        });
                    }
                    sectionsList += `\n💡 أرسل رقم الشعبة أو *إلغاء*${signature}`;
                    await client.sendMessage(userId, sectionsList);
                    userState.set(userId, { step: 'edit_section_select', timestamp: Date.now() });
                    return;
                }
                
                if (option === 4) {
                    await message.react('🗑️');
                    let sectionsList = `🗑️ *اختر شعبة للحذف*\n\n`;
                    if (sections.size === 0) {
                        sectionsList += `⚠️ لا توجد شعب مضافة بعد!\n`;
                    } else {
                        sections.forEach((name, id) => {
                            sectionsList += `${id}. ${name}\n`;
                        });
                    }
                    sectionsList += `\n💡 أرسل رقم الشعبة أو *إلغاء*${signature}`;
                    await client.sendMessage(userId, sectionsList);
                    userState.set(userId, { step: 'delete_section_select', timestamp: Date.now() });
                    return;
                }
            }

            // Handle add section
            if (state.step === 'add_section') {
                const sectionName = content.trim();
                if (!sectionName) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ يرجى إرسال اسم الشعبة!${signature}`);
                    return;
                }
                
                try {
                    // Generate a simple ID (timestamp)
                    const sectionId = Date.now().toString();
                    
                    // Add section
                    sections.set(sectionId, sectionName);
                    saveSections();
                    
                    await message.react('✅');
                    await client.sendMessage(userId, `
✅ *تمت إضافة الشعبة بنجاح!*
📚 الشعبة: ${sectionName}
🆔 المعرف: ${sectionId}
${signature}`);
                    
                    userState.delete(userId);
                } catch (error) {
                    console.error('[❌] Error adding section:', error);
                    await message.react('❌');
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء إضافة الشعبة!${signature}`);
                    userState.delete(userId);
                }
                return;
            }

            // Handle edit section
            if (state.step === 'edit_section_select') {
                const sectionId = content.trim();
                if (!sectionId || !sections.has(sectionId)) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ معرف الشعبة غير صحيح!${signature}`);
                    return;
                }
                
                const sectionName = sections.get(sectionId);
                await message.react('✏️');
                await client.sendMessage(userId, `
✏️ *تعديل شعبة*
الشعبة الحالية: ${sectionName}
أرسل الاسم الجديد للشعبة:
💡 أرسل *إلغاء* للخروج${signature}`);
                userState.set(userId, { step: 'edit_section_data', sectionId: sectionId, timestamp: Date.now() });
                return;
            }

            if (state.step === 'edit_section_data') {
                const newSectionName = content.trim();
                if (!newSectionName) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ يرجى إرسال اسم الشعبة الجديد!${signature}`);
                    return;
                }
                
                try {
                    // Update section
                    sections.set(state.sectionId, newSectionName);
                    saveSections();
                    
                    await message.react('✅');
                    await client.sendMessage(userId, `
✅ *تم تعديل الشعبة بنجاح!*
📚 الاسم الجديد: ${newSectionName}
🆔 المعرف: ${state.sectionId}
${signature}`);
                    
                    userState.delete(userId);
                } catch (error) {
                    console.error('[❌] Error editing section:', error);
                    await message.react('❌');
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء تعديل الشعبة!${signature}`);
                    userState.delete(userId);
                }
                return;
            }

            // Handle delete section
            if (state.step === 'delete_section_select') {
                const sectionId = content.trim();
                if (!sectionId || !sections.has(sectionId)) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ معرف الشعبة غير صحيح!${signature}`);
                    return;
                }
                
                const sectionName = sections.get(sectionId);
                await message.react('🗑️');
                await client.sendMessage(userId, `
🗑️ *تأكيد حذف الشعبة*

الشعبة التي سيتم حذفها:
📚 الشعبة: ${sectionName}
🆔 المعرف: ${sectionId}

هل أنت متأكد من الحذف؟
أرسل *نعم* للتأكيد أو *لا* للإلغاء${signature}`);
                userState.set(userId, { step: 'delete_section_confirm', sectionId: sectionId, timestamp: Date.now() });
                return;
            }

            if (state.step === 'delete_section_confirm') {
                if (content.toLowerCase() === 'نعم') {
                    try {
                        const sectionName = sections.get(state.sectionId);
                        sections.delete(state.sectionId);
                        saveSections();
                        
                        await message.react('✅');
                        await client.sendMessage(userId, `
✅ *تم حذف الشعبة بنجاح!*

تم حذف:
📚 الشعبة: ${sectionName}
🆔 المعرف: ${state.sectionId}
${signature}`);
                        
                        userState.delete(userId);
                    } catch (error) {
                        console.error('[❌] Error deleting section:', error);
                        await message.react('❌');
                        await client.sendMessage(userId, `⚠️ حدث خطأ أثناء حذف الشعبة!${signature}`);
                        userState.delete(userId);
                    }
                } else if (content.toLowerCase() === 'لا') {
                    await message.react('❌');
                    await client.sendMessage(userId, `✅ تم الإلغاء!${signature}`);
                    userState.delete(userId);
                } else {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ يرجى إرسال *نعم* للتأكيد أو *لا* للإلغاء!${signature}`);
                }
                return;
            }

            // Handle classes management (similar to sections)
            if (state.step === 'classes_management_menu') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 4) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }
                
                if (option === 1) {
                    await message.react('📋');
                    let classesList = `📋 *جميع الفصول*\n\n`;
                    if (classes.size === 0) {
                        classesList += `⚠️ لا توجد فصول مضافة بعد!\n`;
                    } else {
                        classes.forEach((name, id) => {
                            classesList += `${id}. ${name}\n`;
                        });
                    }
                    classesList += `💡 إجمالي: ${classes.size} فصل${signature}`;
                    await client.sendMessage(userId, classesList);
                    userState.delete(userId);
                    return;
                }
                
                if (option === 2) {
                    await message.react('➕');
                    await client.sendMessage(userId, `
➕ *إضافة فصل جديد*
أرسل اسم الفصل الجديد:
💡 أرسل *إلغاء* للخروج${signature}`);
                    userState.set(userId, { step: 'add_class', timestamp: Date.now() });
                    return;
                }
                
                if (option === 3) {
                    await message.react('✏️');
                    let classesList = `✏️ *اختر فصل للتعديل*\n\n`;
                    if (classes.size === 0) {
                        classesList += `⚠️ لا توجد فصول مضافة بعد!\n`;
                    } else {
                        classes.forEach((name, id) => {
                            classesList += `${id}. ${name}\n`;
                        });
                    }
                    classesList += `\n💡 أرسل رقم الفصل أو *إلغاء*${signature}`;
                    await client.sendMessage(userId, classesList);
                    userState.set(userId, { step: 'edit_class_select', timestamp: Date.now() });
                    return;
                }
                
                if (option === 4) {
                    await message.react('🗑️');
                    let classesList = `🗑️ *اختر فصل للحذف*\n\n`;
                    if (classes.size === 0) {
                        classesList += `⚠️ لا توجد فصول مضافة بعد!\n`;
                    } else {
                        classes.forEach((name, id) => {
                            classesList += `${id}. ${name}\n`;
                        });
                    }
                    classesList += `\n💡 أرسل رقم الفصل أو *إلغاء*${signature}`;
                    await client.sendMessage(userId, classesList);
                    userState.set(userId, { step: 'delete_class_select', timestamp: Date.now() });
                    return;
                }
            }

            // Handle add class
            if (state.step === 'add_class') {
                const className = content.trim();
                if (!className) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ يرجى إرسال اسم الفصل!${signature}`);
                    return;
                }
                
                try {
                    // Generate a simple ID (timestamp)
                    const classId = Date.now().toString();
                    
                    // Add class
                    classes.set(classId, className);
                    saveClasses();
                    
                    await message.react('✅');
                    await client.sendMessage(userId, `
✅ *تمت إضافة الفصل بنجاح!*
🏫 الفصل: ${className}
🆔 المعرف: ${classId}
${signature}`);
                    
                    userState.delete(userId);
                } catch (error) {
                    console.error('[❌] Error adding class:', error);
                    await message.react('❌');
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء إضافة الفصل!${signature}`);
                    userState.delete(userId);
                }
                return;
            }

            // Handle groups management (similar to sections)
            if (state.step === 'groups_management_menu') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 4) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }
                
                if (option === 1) {
                    await message.react('📋');
                    let groupsList = `📋 *جميع الأفواج*\n\n`;
                    if (groupsData.size === 0) {
                        groupsList += `⚠️ لا توجد أفواج مضافة بعد!\n`;
                    } else {
                        groupsData.forEach((name, id) => {
                            groupsList += `${id}. ${name}\n`;
                        });
                    }
                    groupsList += `💡 إجمالي: ${groupsData.size} فوج${signature}`;
                    await client.sendMessage(userId, groupsList);
                    userState.delete(userId);
                    return;
                }
                
                if (option === 2) {
                    await message.react('➕');
                    await client.sendMessage(userId, `
➕ *إضافة فوج جديد*
أرسل اسم الفوج الجديد:
💡 أرسل *إلغاء* للخروج${signature}`);
                    userState.set(userId, { step: 'add_group', timestamp: Date.now() });
                    return;
                }
                
                if (option === 3) {
                    await message.react('✏️');
                    let groupsList = `✏️ *اختر فوج للتعديل*\n\n`;
                    if (groupsData.size === 0) {
                        groupsList += `⚠️ لا توجد أفواج مضافة بعد!\n`;
                    } else {
                        groupsData.forEach((name, id) => {
                            groupsList += `${id}. ${name}\n`;
                        });
                    }
                    groupsList += `\n💡 أرسل رقم الفوج أو *إلغاء*${signature}`;
                    await client.sendMessage(userId, groupsList);
                    userState.set(userId, { step: 'edit_group_select', timestamp: Date.now() });
                    return;
                }
                
                if (option === 4) {
                    await message.react('🗑️');
                    let groupsList = `🗑️ *اختر فوج للحذف*\n\n`;
                    if (groupsData.size === 0) {
                        groupsList += `⚠️ لا توجد أفواج مضافة بعد!\n`;
                    } else {
                        groupsData.forEach((name, id) => {
                            groupsList += `${id}. ${name}\n`;
                        });
                    }
                    groupsList += `\n💡 أرسل رقم الفوج أو *إلغاء*${signature}`;
                    await client.sendMessage(userId, groupsList);
                    userState.set(userId, { step: 'delete_group_select', timestamp: Date.now() });
                    return;
                }
            }

            // Handle add group
            if (state.step === 'add_group') {
                const groupName = content.trim();
                if (!groupName) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ يرجى إرسال اسم الفوج!${signature}`);
                    return;
                }
                
                try {
                    // Generate a simple ID (timestamp)
                    const groupId = Date.now().toString();
                    
                    // Add group
                    groupsData.set(groupId, groupName);
                    saveGroups();
                    
                    await message.react('✅');
                    await client.sendMessage(userId, `
✅ *تمت إضافة الفوج بنجاح!*
👥 الفوج: ${groupName}
🆔 المعرف: ${groupId}
${signature}`);
                    
                    userState.delete(userId);
                } catch (error) {
                    console.error('[❌] Error adding group:', error);
                    await message.react('❌');
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء إضافة الفوج!${signature}`);
                    userState.delete(userId);
                }
                return;
            }

            // Handle professors management (similar to sections)
            if (state.step === 'professors_management_menu') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 4) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }
                
                if (option === 1) {
                    await message.react('📋');
                    let professorsList = `📋 *جميع الأساتذة*\n\n`;
                    if (professors.size === 0) {
                        professorsList += `⚠️ لا يوجد أساتذة مضافين بعد!\n`;
                    } else {
                        professors.forEach((name, id) => {
                            professorsList += `${id}. ${name}\n`;
                        });
                    }
                    professorsList += `💡 إجمالي: ${professors.size} أستاذ${signature}`;
                    await client.sendMessage(userId, professorsList);
                    userState.delete(userId);
                    return;
                }
                
                if (option === 2) {
                    await message.react('➕');
                    await client.sendMessage(userId, `
➕ *إضافة أستاذ جديد*
أرسل اسم الأستاذ الجديد:
💡 أرسل *إلغاء* للخروج${signature}`);
                    userState.set(userId, { step: 'add_professor', timestamp: Date.now() });
                    return;
                }
                
                if (option === 3) {
                    await message.react('✏️');
                    let professorsList = `✏️ *اختر أستاذ للتعديل*\n\n`;
                    if (professors.size === 0) {
                        professorsList += `⚠️ لا يوجد أساتذة مضافين بعد!\n`;
                    } else {
                        professors.forEach((name, id) => {
                            professorsList += `${id}. ${name}\n`;
                        });
                    }
                    professorsList += `\n💡 أرسل رقم الأستاذ أو *إلغاء*${signature}`;
                    await client.sendMessage(userId, professorsList);
                    userState.set(userId, { step: 'edit_professor_select', timestamp: Date.now() });
                    return;
                }
                
                if (option === 4) {
                    await message.react('🗑️');
                    let professorsList = `🗑️ *اختر أستاذ للحذف*\n\n`;
                    if (professors.size === 0) {
                        professorsList += `⚠️ لا يوجد أساتذة مضافين بعد!\n`;
                    } else {
                        professors.forEach((name, id) => {
                            professorsList += `${id}. ${name}\n`;
                        });
                    }
                    professorsList += `\n💡 أرسل رقم الأستاذ أو *إلغاء*${signature}`;
                    await client.sendMessage(userId, professorsList);
                    userState.set(userId, { step: 'delete_professor_select', timestamp: Date.now() });
                    return;
                }
            }

            // Handle add professor
            if (state.step === 'add_professor') {
                const professorName = content.trim();
                if (!professorName) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ يرجى إرسال اسم الأستاذ!${signature}`);
                    return;
                }
                
                try {
                    // Generate a simple ID (timestamp)
                    const professorId = Date.now().toString();
                    
                    // Add professor
                    professors.set(professorId, professorName);
                    saveProfessors();
                    
                    await message.react('✅');
                    await client.sendMessage(userId, `
✅ *تمت إضافة الأستاذ بنجاح!*
👨‍🏫 الأستاذ: ${professorName}
🆔 المعرف: ${professorId}
${signature}`);
                    
                    userState.delete(userId);
                } catch (error) {
                    console.error('[❌] Error adding professor:', error);
                    await message.react('❌');
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء إضافة الأستاذ!${signature}`);
                    userState.delete(userId);
                }
                return;
            }

            // Handle subjects management (similar to sections)
            if (state.step === 'subjects_management_menu') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 4) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }
                
                if (option === 1) {
                    await message.react('📋');
                    let subjectsList = `📋 *جميع المواد*\n\n`;
                    if (subjects.size === 0) {
                        subjectsList += `⚠️ لا توجد مواد مضافة بعد!\n`;
                    } else {
                        subjects.forEach((name, id) => {
                            subjectsList += `${id}. ${name}\n`;
                        });
                    }
                    subjectsList += `💡 إجمالي: ${subjects.size} مادة${signature}`;
                    await client.sendMessage(userId, subjectsList);
                    userState.delete(userId);
                    return;
                }
                
                if (option === 2) {
                    await message.react('➕');
                    await client.sendMessage(userId, `
➕ *إضافة مادة جديدة*
أرسل اسم المادة الجديدة:
💡 أرسل *إلغاء* للخروج${signature}`);
                    userState.set(userId, { step: 'add_subject', timestamp: Date.now() });
                    return;
                }
                
                if (option === 3) {
                    await message.react('✏️');
                    let subjectsList = `✏️ *اختر مادة للتعديل*\n\n`;
                    if (subjects.size === 0) {
                        subjectsList += `⚠️ لا توجد مواد مضافة بعد!\n`;
                    } else {
                        subjects.forEach((name, id) => {
                            subjectsList += `${id}. ${name}\n`;
                        });
                    }
                    subjectsList += `\n💡 أرسل رقم المادة أو *إلغاء*${signature}`;
                    await client.sendMessage(userId, subjectsList);
                    userState.set(userId, { step: 'edit_subject_select', timestamp: Date.now() });
                    return;
                }
                
                if (option === 4) {
                    await message.react('🗑️');
                    let subjectsList = `🗑️ *اختر مادة للحذف*\n\n`;
                    if (subjects.size === 0) {
                        subjectsList += `⚠️ لا توجد مواد مضافة بعد!\n`;
                    } else {
                        subjects.forEach((name, id) => {
                            subjectsList += `${id}. ${name}\n`;
                        });
                    }
                    subjectsList += `\n💡 أرسل رقم المادة أو *إلغاء*${signature}`;
                    await client.sendMessage(userId, subjectsList);
                    userState.set(userId, { step: 'delete_subject_select', timestamp: Date.now() });
                    return;
                }
            }

            // Handle add subject
            if (state.step === 'add_subject') {
                const subjectName = content.trim();
                if (!subjectName) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ يرجى إرسال اسم المادة!${signature}`);
                    return;
                }
                
                try {
                    // Generate a simple ID (timestamp)
                    const subjectId = Date.now().toString();
                    
                    // Add subject
                    subjects.set(subjectId, subjectName);
                    saveSubjects();
                    
                    await message.react('✅');
                    await client.sendMessage(userId, `
✅ *تمت إضافة المادة بنجاح!*
📖 المادة: ${subjectName}
🆔 المعرف: ${subjectId}
${signature}`);
                    
                    userState.delete(userId);
                } catch (error) {
                    console.error('[❌] Error adding subject:', error);
                    await message.react('❌');
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء إضافة المادة!${signature}`);
                    userState.delete(userId);
                }
                return;
            }

            // Handle lectures management
            if (state.step === 'lectures_management_menu') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 3) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }

                if (option === 1) {
                    await message.react('📋');
                    let lecturesList = `📋 *جميع المحاضرات*\n\n`;
                    if (lecturesMetadata.length === 0) {
                        lecturesList += `⚠️ لا توجد محاضرات مضافة بعد!\n`;
                    } else {
                        lecturesMetadata.forEach((lecture, index) => {
                            const date = lecture.date ? new Date(lecture.date).toLocaleDateString('ar-EG') : 'غير محدد';
                            lecturesList += `${index + 1}. ${lecture.subject} - ${lecture.type} ${lecture.lectureNumber}\n`;
                            lecturesList += `   👨‍🏫 الأستاذ: ${lecture.professor}\n`;
                            lecturesList += `   👥 الفوج: ${lecture.groupNumber}\n`;
                            lecturesList += `   🏫 الفصل: ${lecture.className}\n`;
                            lecturesList += `   📚 الشعبة: ${lecture.sectionName}\n`;
                            lecturesList += `   📅 التاريخ: ${date}\n\n`;
                        });
                    }
                    lecturesList += `💡 إجمالي: ${lecturesMetadata.length} محاضرة${signature}`;
                    await client.sendMessage(userId, lecturesList);
                    userState.delete(userId);
                    return;
                }

                if (option === 2) {
                    await message.react('✏️');
                    let lecturesList = `✏️ *اختر المحاضرة للتعديل*\n\n`;
                    if (lecturesMetadata.length === 0) {
                        lecturesList += `⚠️ لا توجد محاضرات مضافة بعد!\n`;
                    } else {
                        lecturesMetadata.forEach((lecture, index) => {
                            lecturesList += `${index + 1}. ${lecture.subject} - ${lecture.type} ${lecture.lectureNumber}\n`;
                        });
                    }
                    lecturesList += `\n💡 أرسل رقم المحاضرة أو *إلغاء*${signature}`;
                    await client.sendMessage(userId, lecturesList);
                    userState.set(userId, { step: 'edit_lecture_select', timestamp: Date.now() });
                    return;
                }

                if (option === 3) {
                    await message.react('🗑️');
                    let lecturesList = `🗑️ *اختر المحاضرة للحذف*\n\n`;
                    if (lecturesMetadata.length === 0) {
                        lecturesList += `⚠️ لا توجد محاضرات مضافة بعد!\n`;
                    } else {
                        lecturesMetadata.forEach((lecture, index) => {
                            lecturesList += `${index + 1}. ${lecture.subject} - ${lecture.type} ${lecture.lectureNumber}\n`;
                        });
                    }
                    lecturesList += `\n💡 أرسل رقم المحاضرة أو *إلغاء*${signature}`;
                    await client.sendMessage(userId, lecturesList);
                    userState.set(userId, { step: 'delete_lecture_select', timestamp: Date.now() });
                    return;
                }
            }

            // Handle edit lecture
            if (state.step === 'edit_lecture_select') {
                const lectureIndex = parseInt(content) - 1;
                if (isNaN(lectureIndex) || lectureIndex < 0 || lectureIndex >= lecturesMetadata.length) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ رقم محاضرة غير صحيح!${signature}`);
                    return;
                }

                const lecture = lecturesMetadata[lectureIndex];
                await message.react('✏️');
                await client.sendMessage(userId, `
✏️ *تعديل محاضرة*
المحاضرة الحالية:
📖 المادة: ${lecture.subject}
📝 رقم ${lecture.type}: ${lecture.lectureNumber}
👨‍🏫 الأستاذ: ${lecture.professor}
👥 الفوج: ${lecture.groupNumber}
🏫 الفصل: ${lecture.className}
📚 الشعبة: ${lecture.sectionName}

أرسل المعلومات الجديدة في رسالة واحدة:

📖 *اسم المادة:*
📝 *رقم ${lecture.type}:*
👨‍🏫 *اسم الأستاذ:*
👥 *رقم الفوج:*
🏫 *اسم الفصل:*
📚 *اسم الشعبة:*

💡 أرسل *إلغاء* للخروج${signature}`);
                userState.set(userId, { step: 'edit_lecture_data', lectureIndex: lectureIndex, timestamp: Date.now() });
                return;
            }

            if (state.step === 'edit_lecture_data') {
                // Parse information from message
                const info = {};
                const lines = content.split('\n');
                
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (trimmedLine.includes('اسم المادة')) {
                        info.subject = trimmedLine.split(':').slice(1).join(':').trim();
                    } else if (trimmedLine.includes('رقم المحاضرة') || trimmedLine.includes('رقم الملخص')) {
                        info.lectureNumber = trimmedLine.split(':').slice(1).join(':').trim();
                    } else if (trimmedLine.includes('اسم الأستاذ') || trimmedLine.includes('اسم الأساذ')) {
                        info.professor = trimmedLine.split(':').slice(1).join(':').trim();
                    } else if (trimmedLine.includes('رقم الفوج')) {
                        info.groupNumber = trimmedLine.split(':').slice(1).join(':').trim();
                    } else if (trimmedLine.includes('اسم الفصل')) {
                        info.className = trimmedLine.split(':').slice(1).join(':').trim();
                    } else if (trimmedLine.includes('اسم الشعبة')) {
                        info.sectionName = trimmedLine.split(':').slice(1).join(':').trim();
                    }
                }

                // Validate all information is provided
                if (!info.subject || !info.lectureNumber || !info.professor || !info.groupNumber || !info.className || !info.sectionName) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ يرجى إرسال جميع المعلومات المطلوبة!${signature}`);
                    return;
                }

                try {
                    // Update lecture data
                    lecturesMetadata[state.lectureIndex] = {
                        ...lecturesMetadata[state.lectureIndex],
                        subject: info.subject,
                        lectureNumber: info.lectureNumber,
                        professor: info.professor,
                        groupNumber: info.groupNumber,
                        className: info.className,
                        sectionName: info.sectionName
                    };
                    saveLectures();

                    await message.react('✅');
                    await client.sendMessage(userId, `
✅ *تم تعديل المحاضرة بنجاح!*

📖 *المادة:* ${info.subject}
📝 *رقم ${lecturesMetadata[state.lectureIndex].type}:* ${info.lectureNumber}
👨‍🏫 *الأستاذ:* ${info.professor}
👥 *الفوج:* ${info.groupNumber}
🏫 *الفصل:* ${info.className}
📚 *الشعبة:* ${info.sectionName}
${signature}`);

                    userState.delete(userId);
                } catch (error) {
                    console.error('[❌] Error editing lecture:', error);
                    await message.react('❌');
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء تعديل المحاضرة!${signature}`);
                    userState.delete(userId);
                }
                return;
            }

            // Handle delete lecture
            if (state.step === 'delete_lecture_select') {
                const lectureIndex = parseInt(content) - 1;
                if (isNaN(lectureIndex) || lectureIndex < 0 || lectureIndex >= lecturesMetadata.length) {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ رقم محاضرة غير صحيح!${signature}`);
                    return;
                }

                const lecture = lecturesMetadata[lectureIndex];
                await message.react('🗑️');
                await client.sendMessage(userId, `
🗑️ *تأكيد حذف المحاضرة*

المحاضرة التي سيتم حذفها:
📖 المادة: ${lecture.subject}
📝 رقم ${lecture.type}: ${lecture.lectureNumber}
👨‍🏫 الأستاذ: ${lecture.professor}
👥 الفوج: ${lecture.groupNumber}
🏫 الفصل: ${lecture.className}
📚 الشعبة: ${lecture.sectionName}

هل أنت متأكد من الحذف؟
أرسل *نعم* للتأكيد أو *لا* للإلغاء${signature}`);
                userState.set(userId, { step: 'delete_lecture_confirm', lectureIndex: lectureIndex, timestamp: Date.now() });
                return;
            }

            if (state.step === 'delete_lecture_confirm') {
                if (content.toLowerCase() === 'نعم') {
                    try {
                        const lecture = lecturesMetadata[state.lectureIndex];
                        lecturesMetadata.splice(state.lectureIndex, 1);
                        saveLectures();

                        await message.react('✅');
                        await client.sendMessage(userId, `
✅ *تم حذف المحاضرة بنجاح!*

تم حذف:
📖 المادة: ${lecture.subject}
📝 رقم ${lecture.type}: ${lecture.lectureNumber}
👨‍🏫 الأستاذ: ${lecture.professor}
👥 الفوج: ${lecture.groupNumber}
🏫 الفصل: ${lecture.className}
📚 الشعبة: ${lecture.sectionName}
${signature}`);

                        userState.delete(userId);
                    } catch (error) {
                        console.error('[❌] Error deleting lecture:', error);
                        await message.react('❌');
                        await client.sendMessage(userId, `⚠️ حدث خطأ أثناء حذف المحاضرة!${signature}`);
                        userState.delete(userId);
                    }
                } else if (content.toLowerCase() === 'لا') {
                    await message.react('❌');
                    await client.sendMessage(userId, `✅ تم الإلغاء!${signature}`);
                    userState.delete(userId);
                } else {
                    await message.react('⚠️');
                    await client.sendMessage(userId, `⚠️ يرجى إرسال *نعم* للتأكيد أو *لا* للإلغاء!${signature}`);
                }
                return;
            }
        }
    } catch (error) {
        console.error('[❌] Error in message handler:', error);
    }
});

// Start the client
client.initialize();
