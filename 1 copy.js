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
const archivedFiles = new Map(); // الأرشيف

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
const archiveFile = './archive.json'; // ملف الأرشيف الجديد

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

// Load archive data
function loadArchive() {
    try {
        if (fs.existsSync(archiveFile)) {
            const data = fs.readFileSync(archiveFile, 'utf8');
            const archive = data ? JSON.parse(data) : [];
            archivedFiles.clear();
            archive.forEach(item => archivedFiles.set(item.id, item));
            console.log(`[📂] Loaded ${archivedFiles.size} archived files`);
        }
    } catch (error) {
        console.error('[❌] Error loading archive:', error);
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

// Save archive data
function saveArchive() {
    try {
        const list = Array.from(archivedFiles.values());
        fs.writeFileSync(archiveFile, JSON.stringify(list, null, 2));
        console.log('[💾] Saved archive');
    } catch (error) {
        console.error('[❌] Error saving archive:', error);
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
loadArchive();

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
                    { text: 'الشعبة', bold: true },
                    { text: 'الفصل', bold: true },
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
                    lecture.sectionName || '',
                    lecture.className || '',
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
                    fontSize: 10
                },
                content: [
                    { text: 'جدول المحاضرات', style: 'header' },
                    { text: `تاريخ الإنشاء: ${new Date().toLocaleDateString('ar-EG')}`, alignment: 'left' },
                    {
                        table: {
                            headerRows: 1,
                            widths: ['auto', 'auto', 'auto', '*', 'auto', '*', 'auto', 'auto'],
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

// نظام النسخ الاحتياطي التلقائي
cron.schedule('0 0 * * *', async () => {
    try {
        console.log('[🔄] Starting daily backup...');
        
        const backupData = {
            lectures: lecturesMetadata,
            stats: {
                joins: Object.fromEntries(joinStats),
                leaves: Object.fromEntries(leaveStats),
                messages: Object.fromEntries(messageStats),
                lectures: Object.fromEntries(lectureStats)
            },
            blacklist: [...blacklist],
            sections: Array.from(sections.entries()).map(([id, name]) => ({ id, name })),
            classes: Array.from(classes.entries()).map(([id, name]) => ({ id, name })),
            groups: Array.from(groupsData.entries()).map(([id, name]) => ({ id, name })),
            professors: Array.from(professors.entries()).map(([id, name]) => ({ id, name })),
            subjects: Array.from(subjects.entries()).map(([id, name]) => ({ id, name })),
            archive: Array.from(archivedFiles.values()),
            timestamp: new Date().toISOString()
        };
        
        const backupJson = JSON.stringify(backupData, null, 2);
        const backupMedia = new MessageMedia(
            'application/json',
            Buffer.from(backupJson).toString('base64'),
            `backup_${new Date().toISOString().split('T')[0]}.json`
        );
        
        await client.sendMessage(OWNER_ID, backupMedia, {
            caption: `🔄 *النسخة الاحتياطية اليومية*\n\n📅 التاريخ: ${new Date().toLocaleDateString('ar-EG')}\n📊 عدد المحاضرات: ${lecturesMetadata.length}\n📈 عدد المستخدمين: ${joinStats.size}\n📛 عدد المحظورين: ${blacklist.size}\n📁 عدد الملفات المؤرشفة: ${archivedFiles.size}${signature}`
        });
        
        console.log('[✅] Daily backup completed and sent to owner');
    } catch (error) {
        console.error('[❌] Error in daily backup:', error);
    }
});

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

        // إضافة تأخير طفيف في الردود
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

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
                    caption: `📊 *جدول المحاضرات*\n\nتم إنشاء الجدول باستخدام pdfmake!\n📅 التاريخ: ${new Date().toLocaleDateString('ar-EG')}\n📝 عدد المحاضرات: ${lecturesMetadata.length}\n🤖 تم إنشاؤه بواسطة Gemini AI${signature}`
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
                    timestamp: Date.now(),
                    replyTo: replyTo // حفظ مكان الرد
                });
            } else {
                await message.react('⚠️');
                await client.sendMessage(replyTo, `⚠️ هذا الأمر يعمل في المجموعات فقط!${signature}`);
            }
            return;
        }

        // عرض المحاضرات command - متاح لجميع أعضاء المجموعة
        if (content === '!عرض_المحاضرات' || content === '!show_lectures') {
            if (isGroupMessage) {
                // التحقق من وجود بيانات
                if (sections.size === 0 || classes.size === 0) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ لم يتم إعداد بيانات الشعب أو الفصول بعد!${signature}`);
                    return;
                }
                
                await message.react('📚');
                await client.sendMessage(replyTo, `
📚 *عرض المحاضرات*
مرحباً ${senderName}! 🙋‍♂️
يرجى اختيار الشعبة:

💡 أرسل رقم الشعبة أو *إلغاء* للخروج${signature}`);
                
                // Show sections
                let sectionsList = `📚 *اختر الشعبة*\n\n`;
                let index = 1;
                for (const [id, name] of sections) {
                    sectionsList += `${index}. ${name}\n`;
                    index++;
                }
                sectionsList += `\n💡 أرسل رقم الشعبة أو *إلغاء* للخروج${signature}`;
                await client.sendMessage(replyTo, sectionsList);
                
                userState.set(userId, { 
                    step: 'select_section_for_show', 
                    timestamp: Date.now(),
                    replyTo: replyTo // حفظ مكان الرد
                });
            } else {
                await message.react('⚠️');
                await client.sendMessage(replyTo, `⚠️ هذا الأمر يعمل في المجموعات فقط!${signature}`);
            }
            return;
        }

        // Handle PDF download process
        if (userState.has(userId)) {
            const state = userState.get(userId);
            const targetReplyTo = state.replyTo || replyTo; // استخدام مكان الرد المحفوظ

            // Cancel command
            if (content.toLowerCase() === 'إلغاء') {
                await message.react('❌');
                await client.sendMessage(targetReplyTo, `✅ تم الإلغاء!${signature}`);
                userState.delete(userId);
                return;
            }

            // Step: Select PDF type for download
            if (state.step === 'select_pdf_type_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || (option !== 1 && option !== 2)) {
                    await message.react('⚠️');
                    await client.sendMessage(targetReplyTo, `⚠️ خيار غير صحيح! يرجى اختيار 1 للمحاضرة أو 2 للملخص.${signature}`);
                    return;
                }
                
                const pdfType = option === 1 ? 'محاضرة' : 'ملخص';
                
                // Update state
                state.pdfType = pdfType;
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
                await client.sendMessage(targetReplyTo, sectionsList);
                return;
            }

            // Step: Select section for download
            if (state.step === 'select_section_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > sections.size) {
                    await message.react('⚠️');
                    await client.sendMessage(targetReplyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الشعبة الصحيح.${signature}`);
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
                await client.sendMessage(targetReplyTo, classesList);
                return;
            }

            // Step: Select class for download
            if (state.step === 'select_class_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > classes.size) {
                    await message.react('⚠️');
                    await client.sendMessage(targetReplyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الفصل الصحيح.${signature}`);
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
                await client.sendMessage(targetReplyTo, groupsList);
                return;
            }

            // Step: Select group for download
            if (state.step === 'select_group_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > groupsData.size) {
                    await message.react('⚠️');
                    await client.sendMessage(targetReplyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الفوج الصحيح.${signature}`);
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
                await client.sendMessage(targetReplyTo, professorsList);
                return;
            }

            // Step: Select professor for download
            if (state.step === 'select_professor_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > professors.size) {
                    await message.react('⚠️');
                    await client.sendMessage(targetReplyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الأستاذ الصحيح.${signature}`);
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
                await client.sendMessage(targetReplyTo, subjectsList);
                return;
            }

            // Step: Select subject for download
            if (state.step === 'select_subject_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > subjects.size) {
                    await message.react('⚠️');
                    await client.sendMessage(targetReplyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم المادة الصحيح.${signature}`);
                    return;
                }
                
                // Get subject ID and name
                const subjectId = Array.from(subjects.keys())[option - 1];
                const subjectName = subjects.get(subjectId);
                
                // Update state
                state.subjectId = subjectId;
                state.subjectName = subjectName;
                state.step = 'enter_lecture_number_for_download';
                userState.set(userId, state);
                
                // Ask for lecture number
                await client.sendMessage(targetReplyTo, `
📝 *أدخل رقم ${state.pdfType}*
يرجى إدخال رقم ${state.pdfType}:
💡 أرسل *إلغاء* للخروج${signature}`);
                return;
            }

            // Step: Enter lecture number for download
            if (state.step === 'enter_lecture_number_for_download') {
                const lectureNumber = content.trim();
                if (!lectureNumber) {
                    await message.react('⚠️');
                    await client.sendMessage(targetReplyTo, `⚠️ يرجى إدخال رقم ${state.pdfType}!${signature}`);
                    return;
                }
                
                // Update state
                state.lectureNumber = lectureNumber;
                state.step = 'search_lecture';
                userState.set(userId, state);
                
                // Search for the lecture in archive
                const fileKey = `${state.sectionId}_${state.classId}_${state.groupId}_${state.professorId}_${state.subjectId}_${state.lectureNumber}_${state.pdfType}`;
                const archivedFile = archivedFiles.get(fileKey);
                
                if (!archivedFile) {
                    await message.react('❌');
                    await client.sendMessage(targetReplyTo, `⚠️ لم يتم العثور على ${state.pdfType} بهذه المواصفات!${signature}`);
                    userState.delete(userId);
                    return;
                }
                
                // Send the file to the user
                try {
                    // Get the file from archive group
                    const archiveChat = await client.getChatById(PDF_ARCHIVE_GROUP);
                    const archiveMessage = await archiveChat.fetchMessages({ limit: 100 });
                    let fileMessage = null;
                    
                    // Find the message with the file
                    for (const msg of archiveMessage) {
                        if (msg.id._serialized === archivedFile.messageId) {
                            fileMessage = msg;
                            break;
                        }
                    }
                    
                    if (!fileMessage || !fileMessage.hasMedia) {
                        await client.sendMessage(targetReplyTo, `⚠️ عذراً، لم يتم العثور على الملف في الأرشيف!${signature}`);
                        userState.delete(userId);
                        return;
                    }
                    
                    // Download the media
                    const media = await fileMessage.downloadMedia();
                    
                    // Send to user
                    await client.sendMessage(userId, media, {
                        caption: `📄 *${state.pdfType}*\n\n📚 *الشعبة:* ${state.sectionName}\n🏫 *الفصل:* ${state.className}\n👥 *الفوج:* ${state.groupName}\n👨‍🏫 *الأستاذ:* ${state.professorName}\n📖 *المادة:* ${state.subjectName}\n📝 *رقم ${state.pdfType}:* ${state.lectureNumber}\n📅 *تاريخ الإضافة:* ${new Date(archivedFile.date).toLocaleDateString('ar-EG')}${signature}`
                    });
                    
                    await message.react('✅');
                    userState.delete(userId);
                } catch (error) {
                    console.error('[❌] Error sending file from archive:', error);
                    await client.sendMessage(targetReplyTo, `⚠️ حدث خطأ أثناء إرسال الملف: ${error.message}${signature}`);
                    userState.delete(userId);
                }
                return;
            }
            
            // Handle show lectures process
            // Step: Select section for show
            if (state.step === 'select_section_for_show') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > sections.size) {
                    await message.react('⚠️');
                    await client.sendMessage(targetReplyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الشعبة الصحيح.${signature}`);
                    return;
                }
                
                // Get section ID and name
                const sectionId = Array.from(sections.keys())[option - 1];
                const sectionName = sections.get(sectionId);
                
                // Update state
                state.sectionId = sectionId;
                state.sectionName = sectionName;
                state.step = 'select_class_for_show';
                userState.set(userId, state);
                
                // Show classes
                let classesList = `🏫 *اختر الفصل*\n\n`;
                let index = 1;
                for (const [id, name] of classes) {
                    classesList += `${index}. ${name}\n`;
                    index++;
                }
                classesList += `\n💡 أرسل رقم الفصل أو *إلغاء* للخروج${signature}`;
                await client.sendMessage(targetReplyTo, classesList);
                return;
            }
            
            // Step: Select class for show
            if (state.step === 'select_class_for_show') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > classes.size) {
                    await message.react('⚠️');
                    await client.sendMessage(targetReplyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الفصل الصحيح.${signature}`);
                    return;
                }
                
                // Get class ID and name
                const classId = Array.from(classes.keys())[option - 1];
                const className = classes.get(classId);
                
                // Update state
                state.classId = classId;
                state.className = className;
                state.step = 'show_lectures_list';
                userState.set(userId, state);
                
                // Get lectures for this section and class
                const sectionLectures = Array.from(archivedFiles.values()).filter(file => 
                    file.sectionId === state.sectionId && file.classId === state.classId
                );
                
                if (sectionLectures.length === 0) {
                    await client.sendMessage(targetReplyTo, `⚠️ لا توجد محاضرات متاحة في هذه الشعبة والفصل!${signature}`);
                    userState.delete(userId);
                    return;
                }
                
                // Group by subject
                const lecturesBySubject = {};
                sectionLectures.forEach(lecture => {
                    if (!lecturesBySubject[lecture.subjectName]) {
                        lecturesBySubject[lecture.subjectName] = [];
                    }
                    lecturesBySubject[lecture.subjectName].push(lecture);
                });
                
                // Build message
                let messageText = `📚 *المحاضرات المتاحة في ${state.sectionName} - ${state.className}*\n\n`;
                
                for (const [subjectName, lectures] of Object.entries(lecturesBySubject)) {
                    messageText += `📖 *${subjectName}*\n`;
                    lectures.forEach(lecture => {
                        messageText += `   - ${lecture.type} ${lecture.lectureNumber} (الأستاذ: ${lecture.professorName}, الفوج: ${lecture.groupName})\n`;
                    });
                    messageText += `\n`;
                }
                
                messageText += `💡 أرسل *إلغاء* للخروج${signature}`;
                
                await client.sendMessage(targetReplyTo, messageText);
                userState.delete(userId);
                return;
            }
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
                state.step = 'waiting_for_pdf';
                userState.set(userId, state);
                
                await client.sendMessage(replyTo, `
📄 *أرسل ملف ${state.pdfType}*
الآن يرجى إرسال ملف ${state.pdfType} (PDF):
💡 أرسل *إلغاء* للخروج${signature}`);
                return;
            }

            // Step: Waiting for PDF
            if (state.step === 'waiting_for_pdf') {
                if (message.hasMedia) {
                    const media = await message.downloadMedia();
                    if (media.mimetype === 'application/pdf') {
                        // Send to archive group
                        const archiveMessage = await client.sendMessage(PDF_ARCHIVE_GROUP, media, {
                            caption: `📄 *${state.pdfType} جديد*\n\n📚 *الشعبة:* ${state.sectionName}\n🏫 *الفصل:* ${state.className}\n👥 *الفوج:* ${state.groupName}\n👨‍🏫 *الأستاذ:* ${state.professorName}\n📖 *المادة:* ${state.subjectName}\n📝 *رقم ${state.pdfType}:* ${state.lectureNumber}\n📅 *التاريخ:* ${new Date().toLocaleDateString('ar-EG')}\n\n🆔 *معرف المحاضرة:* ${state.sectionId}_${state.classId}_${state.groupId}_${state.professorId}_${state.subjectId}_${state.lectureNumber}_${state.pdfType}${signature}`
                        });
                        
                        // Add to archive
                        const fileKey = `${state.sectionId}_${state.classId}_${state.groupId}_${state.professorId}_${state.subjectId}_${state.lectureNumber}_${state.pdfType}`;
                        archivedFiles.set(fileKey, {
                            id: fileKey,
                            messageId: archiveMessage.id._serialized,
                            type: state.pdfType,
                            sectionId: state.sectionId,
                            sectionName: state.sectionName,
                            classId: state.classId,
                            className: state.className,
                            groupId: state.groupId,
                            groupName: state.groupName,
                            professorId: state.professorId,
                            professorName: state.professorName,
                            subjectId: state.subjectId,
                            subjectName: state.subjectName,
                            lectureNumber: state.lectureNumber,
                            date: new Date().toISOString()
                        });
                        saveArchive();
                        
                        // Create lecture metadata
                        const lectureData = {
                            id: Date.now().toString(),
                            type: state.pdfType,
                            sectionId: state.sectionId,
                            sectionName: state.sectionName,
                            classId: state.classId,
                            className: state.className,
                            groupId: state.groupId,
                            groupName: state.groupName,
                            professorId: state.professorId,
                            professorName: state.professorName,
                            subjectId: state.subjectId,
                            subjectName: state.subjectName,
                            lectureNumber: state.lectureNumber,
                            date: new Date().toISOString()
                        };
                        
                        lecturesMetadata.push(lectureData);
                        saveLectures();
                        
                        await client.sendMessage(replyTo, `✅ تم إضافة ${state.pdfType} بنجاح وحفظه في الأرشيف!${signature}`);
                        userState.delete(userId);
                    } else {
                        await client.sendMessage(replyTo, `⚠️ يرجى إرسال ملف PDF فقط!${signature}`);
                    }
                } else {
                    await client.sendMessage(replyTo, `⚠️ يرجى إرسال ملف PDF!${signature}`);
                }
                return;
            }
        }

        // Show commands
        if (content === '!commands' || content === '!أوامر') {
            await message.react('📋');
            await client.sendMessage(replyTo, `
📋 *قائمة الأوامر المتاحة:*

1. !ask [سؤال] - طرح سؤال على الذكاء الاصطناعي
2. !analyze - تحليل الرسائل في المجموعة
3. !generate [وصف] - إنشاء محتوى باستخدام الذكاء الاصطناعي
4. !جدول_المحاضرات - إنشاء جدول المحاضرات كملف PDF
5. !تثبيت - تثبيت رسالة (للمشرفين)
6. !اضافة_pdf - إضافة ملف PDF جديد
7. !تحميل - تحميل ملف PDF
8. !عرض_المحاضرات - عرض المحاضرات المتاحة
9. !إدارة - لوحة التحكم (للمالك)
10. !commands - عرض هذه القائمة

💡 إرسال *إلغاء* في أي وقت لإلغاء العملية${signature}`);
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
20. تعديل الأوامر
💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
            userState.set(userId, { step: 'admin_menu', timestamp: Date.now() });
            return;
        }

        // Handle admin panel
        if (userState.has(userId) && userId === OWNER_ID) {
            const state = userState.get(userId);

            // Cancel command
            if (content.toLowerCase() === 'إلغاء') {
                await message.react('❌');
                await client.sendMessage(userId, `✅ تم الإلغاء!${signature}`);
                userState.delete(userId);
                return;
            }

            // Admin menu
            if (state.step === 'admin_menu') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 20) {
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }

                switch (option) {
                    case 1: // Add member
                        await client.sendMessage(userId, `👥 *إضافة عضو*\n\nيرجى إرسال رقم الهاتف أو رابط الدعوة:${signature}`);
                        userState.set(userId, { step: 'add_member', timestamp: Date.now() });
                        break;
                    case 2: // Remove member
                        await client.sendMessage(userId, `🚫 *حذف عضو*\n\nيرجى إرسال رقم الهاتف:${signature}`);
                        userState.set(userId, { step: 'remove_member', timestamp: Date.now() });
                        break;
                    case 3: // Promote admin
                        await client.sendMessage(userId, `⬆️ *ترقية عضو لمشرف*\n\nيرجى إرسال رقم الهاتف:${signature}`);
                        userState.set(userId, { step: 'promote_admin', timestamp: Date.now() });
                        break;
                    case 4: // Demote admin
                        await client.sendMessage(userId, `⬇️ *خفض مشرف*\n\nيرجى إرسال رقم الهاتف:${signature}`);
                        userState.set(userId, { step: 'demote_admin', timestamp: Date.now() });
                        break;
                    case 5: // Add programmer
                        await client.sendMessage(userId, `👨‍💻 *إضافة مبرمج*\n\nيرجى إرسال رقم الهاتف:${signature}`);
                        userState.set(userId, { step: 'add_programmer', timestamp: Date.now() });
                        break;
                    case 6: // Remove programmer
                        await client.sendMessage(userId, `❌ *حذف مبرمج*\n\nيرجى إرسال رقم الهاتف:${signature}`);
                        userState.set(userId, { step: 'remove_programmer', timestamp: Date.now() });
                        break;
                    case 7: // Clean group
                        await client.sendMessage(userId, `🧹 *تنظيف المجموعة*\n\nيرجى إرسال معرف المجموعة:${signature}`);
                        userState.set(userId, { step: 'clean_group', timestamp: Date.now() });
                        break;
                    case 8: // Pin message
                        await client.sendMessage(userId, `📌 *تثبيت رسالة*\n\nيرجى إرسال معرف المجموعة:${signature}`);
                        userState.set(userId, { step: 'pin_message', timestamp: Date.now() });
                        break;
                    case 9: // Group statistics
                        await client.sendMessage(userId, `📊 *إحصائيات المجموعات*\n\nجاري جمع الإحصائيات...${signature}`);
                        
                        try {
                            const chats = await client.getChats();
                            const groups = chats.filter(chat => chat.isGroup);
                            let statsMessage = `📊 *إحصائيات المجموعات*\n\n`;
                            
                            for (const group of groups) {
                                const groupId = group.id._serialized;
                                const groupName = group.name;
                                const participants = group.participants.length;
                                const joins = joinStats.get(groupId) || [];
                                const leaves = leaveStats.get(groupId) || [];
                                const messages = messageStats.get(groupId) || 0;
                                
                                statsMessage += `📌 *${groupName}*\n`;
                                statsMessage += `👥 الأعضاء: ${participants}\n`;
                                statsMessage += `📈 الانضمامات: ${joins.length}\n`;
                                statsMessage += `📉 المغادرات: ${leaves.length}\n`;
                                statsMessage += `💬 الرسائل: ${messages}\n\n`;
                            }
                            
                            await client.sendMessage(userId, statsMessage + signature);
                        } catch (error) {
                            console.error('[❌] Error getting group stats:', error);
                            await client.sendMessage(userId, `⚠️ حدث خطأ أثناء جمع الإحصائيات: ${error.message}${signature}`);
                        }
                        
                        userState.delete(userId);
                        break;
                    case 10: // Motivate users
                        await client.sendMessage(userId, `🎯 *تحفيز المستخدمين*\n\nيرجى إرسال معرف المجموعة:${signature}`);
                        userState.set(userId, { step: 'motivate_users', timestamp: Date.now() });
                        break;
                    case 11: // AI analysis
                        await client.sendMessage(userId, `🤖 *تحليل ذكاء اصطناعي*\n\nيرجى إرسال معرف المجموعة:${signature}`);
                        userState.set(userId, { step: 'ai_analysis', timestamp: Date.now() });
                        break;
                    case 12: // Generate content
                        await client.sendMessage(userId, `✍️ *إنشاء محتوى*\n\nيرجى إرسال وصف المحتوى:${signature}`);
                        userState.set(userId, { step: 'generate_content', timestamp: Date.now() });
                        break;
                    case 13: // Lectures table
                        await client.sendMessage(userId, `📊 *جدول المحاضرات*\n\nجاري إنشاء الجدول...${signature}`);
                        
                        try {
                            if (lecturesMetadata.length === 0) {
                                await client.sendMessage(userId, `⚠️ لا توجد محاضرات مضافة بعد!${signature}`);
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
                        } catch (error) {
                            console.error('[❌] Error generating lectures table:', error);
                            await client.sendMessage(userId, `⚠️ حدث خطأ أثناء إنشاء جدول المحاضرات: ${error.message}${signature}`);
                        }
                        
                        userState.delete(userId);
                        break;
                    case 14: // Manage lectures
                        await client.sendMessage(userId, `📚 *إدارة المحاضرات*\n\nاختر العملية:\n1. عرض المحاضرات\n2. حذف محاضرة\n💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                        userState.set(userId, { step: 'manage_lectures', timestamp: Date.now() });
                        break;
                    case 15: // Manage sections
                        await client.sendMessage(userId, `📚 *إدارة الشعب*\n\nاختر العملية:\n1. عرض الشعب\n2. إضافة شعبة\n3. حذف شعبة\n💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                        userState.set(userId, { step: 'manage_sections', timestamp: Date.now() });
                        break;
                    case 16: // Manage classes
                        await client.sendMessage(userId, `🏫 *إدارة الفصول*\n\nاختر العملية:\n1. عرض الفصول\n2. إضافة فصل\n3. حذف فصل\n💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                        userState.set(userId, { step: 'manage_classes', timestamp: Date.now() });
                        break;
                    case 17: // Manage groups
                        await client.sendMessage(userId, `👥 *إدارة الأفواج*\n\nاختر العملية:\n1. عرض الأفواج\n2. إضافة فوج\n3. حذف فوج\n💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                        userState.set(userId, { step: 'manage_groups', timestamp: Date.now() });
                        break;
                    case 18: // Manage professors
                        await client.sendMessage(userId, `👨‍🏫 *إدارة الأساتذة*\n\nاختر العملية:\n1. عرض الأساتذة\n2. إضافة أستاذ\n3. حذف أستاذ\n💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                        userState.set(userId, { step: 'manage_professors', timestamp: Date.now() });
                        break;
                    case 19: // Manage subjects
                        await client.sendMessage(userId, `📖 *إدارة المواد*\n\nاختر العملية:\n1. عرض المواد\n2. إضافة مادة\n3. حذف مادة\n💡 أرسل رقم الخيار أو *إلغاء*${signature}`);
                        userState.set(userId, { step: 'manage_subjects', timestamp: Date.now() });
                        break;
                    case 20: // Edit commands
                        await client.sendMessage(userId, `⚙️ *تعديل الأوامر*\n\nهذه الميزة قيد التطوير${signature}`);
                        userState.delete(userId);
                        break;
                }
                return;
            }

            // Handle admin sub-menus
            // Add member
            if (state.step === 'add_member') {
                const phoneOrLink = content.trim();
                if (!phoneOrLink) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال رقم الهاتف أو رابط الدعوة!${signature}`);
                    return;
                }

                await client.sendMessage(userId, `👥 *إضافة عضو*\n\nيرجى إرسال معرف المجموعة:${signature}`);
                userState.set(userId, { step: 'add_member_to_group', phoneOrLink, timestamp: Date.now() });
                return;
            }

            if (state.step === 'add_member_to_group') {
                const groupId = content.trim();
                if (!groupId) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال معرف المجموعة!${signature}`);
                    return;
                }

                try {
                    if (state.phoneOrLink.includes('chat.whatsapp.com')) {
                        // It's a link
                        await client.acceptInvite(state.phoneOrLink.split('/').pop());
                        await client.sendMessage(userId, `✅ تم الانضمام إلى المجموعة بنجاح!${signature}`);
                    } else {
                        // It's a phone number
                        const formattedPhone = formatPhoneNumber(state.phoneOrLink);
                        await client.addParticipant(groupId, formattedPhone);
                        await client.sendMessage(userId, `✅ تمت إضافة العضو بنجاح!${signature}`);
                    }
                } catch (error) {
                    console.error('[❌] Error adding member:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء إضافة العضو: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            // Remove member
            if (state.step === 'remove_member') {
                const phone = content.trim();
                if (!phone) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال رقم الهاتف!${signature}`);
                    return;
                }

                await client.sendMessage(userId, `🚫 *حذف عضو*\n\nيرجى إرسال معرف المجموعة:${signature}`);
                userState.set(userId, { step: 'remove_member_from_group', phone, timestamp: Date.now() });
                return;
            }

            if (state.step === 'remove_member_from_group') {
                const groupId = content.trim();
                if (!groupId) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال معرف المجموعة!${signature}`);
                    return;
                }

                try {
                    const formattedPhone = formatPhoneNumber(state.phone);
                    await client.removeParticipant(groupId, formattedPhone);
                    await client.sendMessage(userId, `✅ تم حذف العضو بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error removing member:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء حذف العضو: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            // Promote admin
            if (state.step === 'promote_admin') {
                const phone = content.trim();
                if (!phone) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال رقم الهاتف!${signature}`);
                    return;
                }

                await client.sendMessage(userId, `⬆️ *ترقية عضو لمشرف*\n\nيرجى إرسال معرف المجموعة:${signature}`);
                userState.set(userId, { step: 'promote_member_in_group', phone, timestamp: Date.now() });
                return;
            }

            if (state.step === 'promote_member_in_group') {
                const groupId = content.trim();
                if (!groupId) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال معرف المجموعة!${signature}`);
                    return;
                }

                try {
                    const formattedPhone = formatPhoneNumber(state.phone);
                    await client.promoteParticipant(groupId, formattedPhone);
                    await client.sendMessage(userId, `✅ تم ترقية العضو لمشرف بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error promoting admin:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء ترقية العضو: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            // Demote admin
            if (state.step === 'demote_admin') {
                const phone = content.trim();
                if (!phone) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال رقم الهاتف!${signature}`);
                    return;
                }

                await client.sendMessage(userId, `⬇️ *خفض مشرف*\n\nيرجى إرسال معرف المجموعة:${signature}`);
                userState.set(userId, { step: 'demote_admin_in_group', phone, timestamp: Date.now() });
                return;
            }

            if (state.step === 'demote_admin_in_group') {
                const groupId = content.trim();
                if (!groupId) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال معرف المجموعة!${signature}`);
                    return;
                }

                try {
                    const formattedPhone = formatPhoneNumber(state.phone);
                    await client.demoteParticipant(groupId, formattedPhone);
                    await client.sendMessage(userId, `✅ تم خفض المشرف بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error demoting admin:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء خفض المشرف: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            // Add programmer
            if (state.step === 'add_programmer') {
                const phone = content.trim();
                if (!phone) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال رقم الهاتف!${signature}`);
                    return;
                }

                try {
                    const formattedPhone = formatPhoneNumber(phone);
                    admins.add(formattedPhone);
                    saveAdmins();
                    await client.sendMessage(userId, `✅ تمت إضافة المبرمج بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error adding programmer:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء إضافة المبرمج: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            // Remove programmer
            if (state.step === 'remove_programmer') {
                const phone = content.trim();
                if (!phone) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال رقم الهاتف!${signature}`);
                    return;
                }

                try {
                    const formattedPhone = formatPhoneNumber(phone);
                    admins.delete(formattedPhone);
                    saveAdmins();
                    await client.sendMessage(userId, `✅ تم حذف المبرمج بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error removing programmer:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء حذف المبرمج: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            // Clean group
            if (state.step === 'clean_group') {
                const groupId = content.trim();
                if (!groupId) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال معرف المجموعة!${signature}`);
                    return;
                }

                try {
                    const chat = await client.getChatById(groupId);
                    if (!chat.isGroup) {
                        await client.sendMessage(userId, `⚠️ المعرف المرسل ليس لمجموعة!${signature}`);
                        return;
                    }

                    await client.sendMessage(userId, `🧹 *تنظيف المجموعة*\n\nجاري بدء عملية التنظيف...${signature}`);

                    // Get all participants
                    const participants = chat.participants;
                    let removedCount = 0;

                    for (const participant of participants) {
                        // Skip admins and the bot itself
                        if (participant.isAdmin || participant.isSuperAdmin || participant.id._serialized === client.info.wid._serialized) {
                            continue;
                        }

                        try {
                            await client.removeParticipant(groupId, participant.id._serialized);
                            removedCount++;
                            console.log(`[🧹] Removed ${participant.id._serialized} from ${groupId}`);
                        } catch (error) {
                            console.error(`[❌] Error removing ${participant.id._serialized}:`, error);
                        }
                    }

                    await client.sendMessage(userId, `✅ اكتملت عملية التنظيف! تم حذف ${removedCount} عضو${signature}`);
                } catch (error) {
                    console.error('[❌] Error cleaning group:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء تنظيف المجموعة: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            // Pin message
            if (state.step === 'pin_message') {
                const groupId = content.trim();
                if (!groupId) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال معرف المجموعة!${signature}`);
                    return;
                }

                await client.sendMessage(userId, `📌 *تثبيت رسالة*\n\nيرجى إرسال معرف الرسالة:${signature}`);
                userState.set(userId, { step: 'pin_message_in_group', groupId, timestamp: Date.now() });
                return;
            }

            if (state.step === 'pin_message_in_group') {
                const messageId = content.trim();
                if (!messageId) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال معرف الرسالة!${signature}`);
                    return;
                }

                try {
                    const chat = await client.getChatById(state.groupId);
                    const messages = await chat.fetchMessages({ limit: 100 });
                    let messageToPin = null;

                    for (const msg of messages) {
                        if (msg.id._serialized === messageId) {
                            messageToPin = msg;
                            break;
                        }
                    }

                    if (!messageToPin) {
                        await client.sendMessage(userId, `⚠️ لم يتم العثور على الرسالة!${signature}`);
                        return;
                    }

                    await messageToPin.pin();
                    await client.sendMessage(userId, `✅ تم تثبيت الرسالة بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error pinning message:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء تثبيت الرسالة: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            // Motivate users
            if (state.step === 'motivate_users') {
                const groupId = content.trim();
                if (!groupId) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال معرف المجموعة!${signature}`);
                    return;
                }

                try {
                    const chat = await client.getChatById(groupId);
                    if (!chat.isGroup) {
                        await client.sendMessage(userId, `⚠️ المعرف المرسل ليس لمجموعة!${signature}`);
                        return;
                    }

                    await client.sendMessage(userId, `🎯 *تحفيز المستخدمين*\n\nيرجى إرسال رسالة التحفيز:${signature}`);
                    userState.set(userId, { step: 'send_motivation', groupId, timestamp: Date.now() });
                } catch (error) {
                    console.error('[❌] Error getting group:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء الوصول للمجموعة: ${error.message}${signature}`);
                    userState.delete(userId);
                }
                return;
            }

            if (state.step === 'send_motivation') {
                const motivationText = content.trim();
                if (!motivationText) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال رسالة التحفيز!${signature}`);
                    return;
                }

                try {
                    await client.sendMessage(state.groupId, motivationText + signature);
                    await client.sendMessage(userId, `✅ تم إرسال رسالة التحفيز بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error sending motivation:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء إرسال رسالة التحفيز: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            // AI analysis
            if (state.step === 'ai_analysis') {
                const groupId = content.trim();
                if (!groupId) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال معرف المجموعة!${signature}`);
                    return;
                }

                try {
                    const chat = await client.getChatById(groupId);
                    if (!chat.isGroup) {
                        await client.sendMessage(userId, `⚠️ المعرف المرسل ليس لمجموعة!${signature}`);
                        return;
                    }

                    await client.sendMessage(userId, `🤖 *تحليل ذكاء اصطناعي*\n\nجاري تحليل الرسائل...${signature}`);

                    // Get recent messages
                    const messages = await chat.fetchMessages({ limit: 50 });
                    let analysisResults = [];

                    for (const msg of messages.reverse()) {
                        if (msg.body && !msg.body.startsWith('!')) {
                            const msgContact = await msg.getContact();
                            const msgSenderName = msgContact.pushname || msgContact.name || "User";
                            
                            const analysis = await analyzeUserIntent(msg.body, msgSenderName, true, chat.name);
                            
                            if (analysis.confidence > 0.7 && analysis.action !== 'none') {
                                analysisResults.push({
                                    sender: msgSenderName,
                                    message: msg.body,
                                    intent: analysis.intent,
                                    response: analysis.response,
                                    action: analysis.action
                                });
                            }
                        }
                    }

                    if (analysisResults.length === 0) {
                        await client.sendMessage(userId, `✅ تم تحليل الرسائل ولم يتم العثور على أي إجراء مطلوب${signature}`);
                    } else {
                        let resultsText = `🤖 *نتائج تحليل الذكاء الاصطناعي*\n\n`;
                        
                        for (const result of analysisResults) {
                            resultsText += `👤 *المرسل:* ${result.sender}\n`;
                            resultsText += `💬 *الرسالة:* ${result.message}\n`;
                            resultsText += `🎯 *النية:* ${result.intent}\n`;
                            resultsText += `💡 *الرد المقترح:* ${result.response}\n`;
                            resultsText += `⚙️ *الإجراء:* ${result.action}\n\n`;
                        }
                        
                        await client.sendMessage(userId, resultsText + signature);
                    }
                } catch (error) {
                    console.error('[❌] Error in AI analysis:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء تحليل الرسائل: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            // Generate content
            if (state.step === 'generate_content') {
                const prompt = content.trim();
                if (!prompt) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال وصف المحتوى!${signature}`);
                    return;
                }

                try {
                    await client.sendMessage(userId, `✍️ *جاري إنشاء المحتوى...*`);
                    const aiResponse = await askGemini(`أنشئ محتوى بناءً على الوصف التالي: ${prompt}`);
                    await client.sendMessage(userId, `${aiResponse}${signature}`);
                } catch (error) {
                    console.error('[❌] Error generating content:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء إنشاء المحتوى: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            // Manage lectures
            if (state.step === 'manage_lectures') {
                const option = parseInt(content);
                if (isNaN(option) || (option !== 1 && option !== 2)) {
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }

                if (option === 1) {
                    // Show lectures
                    if (lecturesMetadata.length === 0) {
                        await client.sendMessage(userId, `⚠️ لا توجد محاضرات مضافة بعد!${signature}`);
                        userState.delete(userId);
                        return;
                    }

                    let lecturesList = `📚 *قائمة المحاضرات*\n\n`;
                    lecturesMetadata.forEach((lecture, index) => {
                        lecturesList += `${index + 1}. ${lecture.type} ${lecture.lectureNumber} - ${lecture.subjectName} (${lecture.sectionName} - ${lecture.className})\n`;
                    });

                    await client.sendMessage(userId, lecturesList + signature);
                    userState.delete(userId);
                } else {
                    // Delete lecture
                    await client.sendMessage(userId, `🗑️ *حذف محاضرة*\n\nيرجى إرسال رقم المحاضرة:${signature}`);
                    userState.set(userId, { step: 'delete_lecture', timestamp: Date.now() });
                }
                return;
            }

            if (state.step === 'delete_lecture') {
                const lectureIndex = parseInt(content);
                if (isNaN(lectureIndex) || lectureIndex < 1 || lectureIndex > lecturesMetadata.length) {
                    await client.sendMessage(userId, `⚠️ رقم المحاضرة غير صحيح!${signature}`);
                    return;
                }

                try {
                    const lectureToDelete = lecturesMetadata[lectureIndex - 1];
                    
                    // Remove from archive
                    const fileKey = `${lectureToDelete.sectionId}_${lectureToDelete.classId}_${lectureToDelete.groupId}_${lectureToDelete.professorId}_${lectureToDelete.subjectId}_${lectureToDelete.lectureNumber}_${lectureToDelete.type}`;
                    archivedFiles.delete(fileKey);
                    saveArchive();
                    
                    // Remove from lectures metadata
                    lecturesMetadata.splice(lectureIndex - 1, 1);
                    saveLectures();
                    
                    await client.sendMessage(userId, `✅ تم حذف المحاضرة بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error deleting lecture:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء حذف المحاضرة: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            // Manage sections
            if (state.step === 'manage_sections') {
                const option = parseInt(content);
                if (isNaN(option) || (option !== 1 && option !== 2 && option !== 3)) {
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }

                if (option === 1) {
                    // Show sections
                    if (sections.size === 0) {
                        await client.sendMessage(userId, `⚠️ لا توجد شعب مضافة بعد!${signature}`);
                        userState.delete(userId);
                        return;
                    }

                    let sectionsList = `📚 *قائمة الشعب*\n\n`;
                    let index = 1;
                    for (const [id, name] of sections) {
                        sectionsList += `${index}. ${name}\n`;
                        index++;
                    }

                    await client.sendMessage(userId, sectionsList + signature);
                    userState.delete(userId);
                } else if (option === 2) {
                    // Add section
                    await client.sendMessage(userId, `📚 *إضافة شعبة*\n\nيرجى إرسال اسم الشعبة:${signature}`);
                    userState.set(userId, { step: 'add_section', timestamp: Date.now() });
                } else {
                    // Delete section
                    await client.sendMessage(userId, `🗑️ *حذف شعبة*\n\nيرجى إرسال رقم الشعبة:${signature}`);
                    userState.set(userId, { step: 'delete_section', timestamp: Date.now() });
                }
                return;
            }

            if (state.step === 'add_section') {
                const sectionName = content.trim();
                if (!sectionName) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال اسم الشعبة!${signature}`);
                    return;
                }

                try {
                    const sectionId = Date.now().toString();
                    sections.set(sectionId, sectionName);
                    saveSections();
                    await client.sendMessage(userId, `✅ تمت إضافة الشعبة بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error adding section:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء إضافة الشعبة: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            if (state.step === 'delete_section') {
                const sectionIndex = parseInt(content);
                if (isNaN(sectionIndex) || sectionIndex < 1 || sectionIndex > sections.size) {
                    await client.sendMessage(userId, `⚠️ رقم الشعبة غير صحيح!${signature}`);
                    return;
                }

                try {
                    const sectionId = Array.from(sections.keys())[sectionIndex - 1];
                    sections.delete(sectionId);
                    saveSections();
                    await client.sendMessage(userId, `✅ تم حذف الشعبة بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error deleting section:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء حذف الشعبة: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            // Manage classes
            if (state.step === 'manage_classes') {
                const option = parseInt(content);
                if (isNaN(option) || (option !== 1 && option !== 2 && option !== 3)) {
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }

                if (option === 1) {
                    // Show classes
                    if (classes.size === 0) {
                        await client.sendMessage(userId, `⚠️ لا توجد فصول مضافة بعد!${signature}`);
                        userState.delete(userId);
                        return;
                    }

                    let classesList = `🏫 *قائمة الفصول*\n\n`;
                    let index = 1;
                    for (const [id, name] of classes) {
                        classesList += `${index}. ${name}\n`;
                        index++;
                    }

                    await client.sendMessage(userId, classesList + signature);
                    userState.delete(userId);
                } else if (option === 2) {
                    // Add class
                    await client.sendMessage(userId, `🏫 *إضافة فصل*\n\nيرجى إرسال اسم الفصل:${signature}`);
                    userState.set(userId, { step: 'add_class', timestamp: Date.now() });
                } else {
                    // Delete class
                    await client.sendMessage(userId, `🗑️ *حذف فصل*\n\nيرجى إرسال رقم الفصل:${signature}`);
                    userState.set(userId, { step: 'delete_class', timestamp: Date.now() });
                }
                return;
            }

            if (state.step === 'add_class') {
                const className = content.trim();
                if (!className) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال اسم الفصل!${signature}`);
                    return;
                }

                try {
                    const classId = Date.now().toString();
                    classes.set(classId, className);
                    saveClasses();
                    await client.sendMessage(userId, `✅ تمت إضافة الفصل بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error adding class:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء إضافة الفصل: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            if (state.step === 'delete_class') {
                const classIndex = parseInt(content);
                if (isNaN(classIndex) || classIndex < 1 || classIndex > classes.size) {
                    await client.sendMessage(userId, `⚠️ رقم الفصل غير صحيح!${signature}`);
                    return;
                }

                try {
                    const classId = Array.from(classes.keys())[classIndex - 1];
                    classes.delete(classId);
                    saveClasses();
                    await client.sendMessage(userId, `✅ تم حذف الفصل بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error deleting class:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء حذف الفصل: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            // Manage groups
            if (state.step === 'manage_groups') {
                const option = parseInt(content);
                if (isNaN(option) || (option !== 1 && option !== 2 && option !== 3)) {
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }

                if (option === 1) {
                    // Show groups
                    if (groupsData.size === 0) {
                        await client.sendMessage(userId, `⚠️ لا توجد أفواج مضافة بعد!${signature}`);
                        userState.delete(userId);
                        return;
                    }

                    let groupsList = `👥 *قائمة الأفواج*\n\n`;
                    let index = 1;
                    for (const [id, name] of groupsData) {
                        groupsList += `${index}. ${name}\n`;
                        index++;
                    }

                    await client.sendMessage(userId, groupsList + signature);
                    userState.delete(userId);
                } else if (option === 2) {
                    // Add group
                    await client.sendMessage(userId, `👥 *إضافة فوج*\n\nيرجى إرسال اسم الفوج:${signature}`);
                    userState.set(userId, { step: 'add_group', timestamp: Date.now() });
                } else {
                    // Delete group
                    await client.sendMessage(userId, `🗑️ *حذف فوج*\n\nيرجى إرسال رقم الفوج:${signature}`);
                    userState.set(userId, { step: 'delete_group', timestamp: Date.now() });
                }
                return;
            }

            if (state.step === 'add_group') {
                const groupName = content.trim();
                if (!groupName) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال اسم الفوج!${signature}`);
                    return;
                }

                try {
                    const groupId = Date.now().toString();
                    groupsData.set(groupId, groupName);
                    saveGroups();
                    await client.sendMessage(userId, `✅ تمت إضافة الفوج بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error adding group:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء إضافة الفوج: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            if (state.step === 'delete_group') {
                const groupIndex = parseInt(content);
                if (isNaN(groupIndex) || groupIndex < 1 || groupIndex > groupsData.size) {
                    await client.sendMessage(userId, `⚠️ رقم الفوج غير صحيح!${signature}`);
                    return;
                }

                try {
                    const groupId = Array.from(groupsData.keys())[groupIndex - 1];
                    groupsData.delete(groupId);
                    saveGroups();
                    await client.sendMessage(userId, `✅ تم حذف الفوج بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error deleting group:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء حذف الفوج: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            // Manage professors
            if (state.step === 'manage_professors') {
                const option = parseInt(content);
                if (isNaN(option) || (option !== 1 && option !== 2 && option !== 3)) {
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }

                if (option === 1) {
                    // Show professors
                    if (professors.size === 0) {
                        await client.sendMessage(userId, `⚠️ لا يوجد أساتذة مضافين بعد!${signature}`);
                        userState.delete(userId);
                        return;
                    }

                    let professorsList = `👨‍🏫 *قائمة الأساتذة*\n\n`;
                    let index = 1;
                    for (const [id, name] of professors) {
                        professorsList += `${index}. ${name}\n`;
                        index++;
                    }

                    await client.sendMessage(userId, professorsList + signature);
                    userState.delete(userId);
                } else if (option === 2) {
                    // Add professor
                    await client.sendMessage(userId, `👨‍🏫 *إضافة أستاذ*\n\nيرجى إرسال اسم الأستاذ:${signature}`);
                    userState.set(userId, { step: 'add_professor', timestamp: Date.now() });
                } else {
                    // Delete professor
                    await client.sendMessage(userId, `🗑️ *حذف أستاذ*\n\nيرجى إرسال رقم الأستاذ:${signature}`);
                    userState.set(userId, { step: 'delete_professor', timestamp: Date.now() });
                }
                return;
            }

            if (state.step === 'add_professor') {
                const professorName = content.trim();
                if (!professorName) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال اسم الأستاذ!${signature}`);
                    return;
                }

                try {
                    const professorId = Date.now().toString();
                    professors.set(professorId, professorName);
                    saveProfessors();
                    await client.sendMessage(userId, `✅ تمت إضافة الأستاذ بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error adding professor:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء إضافة الأستاذ: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            if (state.step === 'delete_professor') {
                const professorIndex = parseInt(content);
                if (isNaN(professorIndex) || professorIndex < 1 || professorIndex > professors.size) {
                    await client.sendMessage(userId, `⚠️ رقم الأستاذ غير صحيح!${signature}`);
                    return;
                }

                try {
                    const professorId = Array.from(professors.keys())[professorIndex - 1];
                    professors.delete(professorId);
                    saveProfessors();
                    await client.sendMessage(userId, `✅ تم حذف الأستاذ بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error deleting professor:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء حذف الأستاذ: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            // Manage subjects
            if (state.step === 'manage_subjects') {
                const option = parseInt(content);
                if (isNaN(option) || (option !== 1 && option !== 2 && option !== 3)) {
                    await client.sendMessage(userId, `⚠️ خيار غير صحيح!${signature}`);
                    return;
                }

                if (option === 1) {
                    // Show subjects
                    if (subjects.size === 0) {
                        await client.sendMessage(userId, `⚠️ لا توجد مواد مضافة بعد!${signature}`);
                        userState.delete(userId);
                        return;
                    }

                    let subjectsList = `📖 *قائمة المواد*\n\n`;
                    let index = 1;
                    for (const [id, name] of subjects) {
                        subjectsList += `${index}. ${name}\n`;
                        index++;
                    }

                    await client.sendMessage(userId, subjectsList + signature);
                    userState.delete(userId);
                } else if (option === 2) {
                    // Add subject
                    await client.sendMessage(userId, `📖 *إضافة مادة*\n\nيرجى إرسال اسم المادة:${signature}`);
                    userState.set(userId, { step: 'add_subject', timestamp: Date.now() });
                } else {
                    // Delete subject
                    await client.sendMessage(userId, `🗑️ *حذف مادة*\n\nيرجى إرسال رقم المادة:${signature}`);
                    userState.set(userId, { step: 'delete_subject', timestamp: Date.now() });
                }
                return;
            }

            if (state.step === 'add_subject') {
                const subjectName = content.trim();
                if (!subjectName) {
                    await client.sendMessage(userId, `⚠️ يرجى إرسال اسم المادة!${signature}`);
                    return;
                }

                try {
                    const subjectId = Date.now().toString();
                    subjects.set(subjectId, subjectName);
                    saveSubjects();
                    await client.sendMessage(userId, `✅ تمت إضافة المادة بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error adding subject:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء إضافة المادة: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }

            if (state.step === 'delete_subject') {
                const subjectIndex = parseInt(content);
                if (isNaN(subjectIndex) || subjectIndex < 1 || subjectIndex > subjects.size) {
                    await client.sendMessage(userId, `⚠️ رقم المادة غير صحيح!${signature}`);
                    return;
                }

                try {
                    const subjectId = Array.from(subjects.keys())[subjectIndex - 1];
                    subjects.delete(subjectId);
                    saveSubjects();
                    await client.sendMessage(userId, `✅ تم حذف المادة بنجاح!${signature}`);
                } catch (error) {
                    console.error('[❌] Error deleting subject:', error);
                    await client.sendMessage(userId, `⚠️ حدث خطأ أثناء حذف المادة: ${error.message}${signature}`);
                }

                userState.delete(userId);
                return;
            }
        }
    } catch (error) {
        console.error('[❌] Error in message handler:', error);
    }
});

client.initialize();