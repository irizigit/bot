require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
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

// هياكل البيانات
const sections = new Map();     
const classes = new Map();      
const groupsData = new Map();   
const professors = new Map();   
const subjects = new Map();     

// ============================================
// الإعدادات والمتغيرات
// ============================================
let groupId = null;
let isBotReady = false;

const PDF_ARCHIVE_GROUP = process.env.PDF_ARCHIVE_GROUP || '120363403563982270@g.us';
const OWNER_ID = process.env.OWNER_ID || '212621957775@c.us';

// مسارات الملفات
const blacklistFile = './blacklist.json';
const sectionsFile = './sections.json';
const classesFile = './classes.json';
const groupsFile = './groups.json';
const professorsFile = './professors.json';
const subjectsFile = './subjects.json';

// ============================================
// دوال تحميل البيانات
// ============================================
function loadBlacklist() {
    try {
        if (fs.existsSync(blacklistFile)) {
            const data = fs.readFileSync(blacklistFile, 'utf8');
            const list = data ? JSON.parse(data) : [];
            blacklist.clear();
            list.forEach(num => blacklist.add(num));
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
        }
    } catch (error) { console.error('[❌] Error loading subjects:', error); }
}

// ============================================
// دوال حفظ البيانات
// ============================================
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
loadBlacklist();
loadSections();
loadClasses();
loadGroups();
loadProfessors();
loadSubjects();

// توقيع محسّن ومزخرف لرسائل البوت
const signature = "\n\n━━━━━━━━━━━━━━━━━━\n👨‍💻 *Dev by:* IRIZI ✨";

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
                reject(new Error('الخطوط المطلوبة غير موجودة.'));
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
                    { table: { headerRows: 1, widths: ['auto', '*', 'auto', '*', 'auto', 'auto'], body }, layout: 'lightHorizontalLines' }
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

// ============================================
// أحداث العميل
// ============================================
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('[✅] Client ready!');
    isBotReady = true;
    const chats = await client.getChats();
    for (const chat of chats) {
        if (chat.isGroup) {
            groupsMetadata.set(chat.id._serialized, chat.name);
        }
    }
});

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

        // --- أمر جدول المحاضرات ---
        if (content === '!جدول_المحاضرات' || content === '!lectures_table') {
            try {
                const res = await db.query('SELECT subject_name, lecture_number, professor_name, group_name, date_added FROM lectures ORDER BY id ASC');
                if (res.rows.length === 0) {
                    await client.sendMessage(replyTo, `⚠️ *عذراً!* لا توجد محاضرات مضافة حتى الآن.${signature}`);
                    return;
                }
                const pdfBuffer = await generateLecturesTablePDF(res.rows);
                const media = new MessageMedia('application/pdf', pdfBuffer.toString('base64'), `جدول.pdf`);
                await client.sendMessage(replyTo, media, { caption: `📊 *إليك جدول المحاضرات محدثاً* ✨${signature}` });
            } catch (error) {
                await client.sendMessage(replyTo, `❌ *حدث خطأ!* لم أتمكن من إنشاء الجدول، يرجى المحاولة لاحقاً.${signature}`);
            }
            return;
        }

        // --- لوحة الإدارة ---
        if (!isGroupMessage && userId === OWNER_ID && content === '!إدارة') {
            await client.sendMessage(userId, `🛠️ *لوحة تحكم المدير* 🛠️
━━━━━━━━━━━━━━━━━━

👥 *الأعضاء والمشرفين:*
1. ➕ إضافة عضو
2. ➖ حذف عضو
3. ⬆️ ترقية عضو
4. ⬇️ خفض مشرف
5. 👨‍💻 إضافة مبرمج
6. ❌ حذف مبرمج
7. 🧹 تنظيف المجموعة

⚙️ *إدارة المحتوى:*
8. 📌 تثبيت رسالة
9. 📊 جدول المحاضرات
10. 📚 إدارة المحاضرات

🗂️ *إدارة البيانات:*
11. 🏷️ إدارة الشعب
12. 🏫 إدارة الفصول
13. 👥 إدارة الأفواج
14. 👨‍🏫 إدارة الأساتذة
15. 📖 إدارة المواد

📢 *التواصل:*
16. 🌐 بث لجميع المجموعات
17. 🎯 بث لمجموعة مخصصة

━━━━━━━━━━━━━━━━━━
💡 _أرسل رقم الخيار لتنفيذه أو اكتب_ *إلغاء* _للخروج._${signature}`);
            userState.set(userId, { step: 'admin_menu', timestamp: Date.now() });
            return;
        }

        // ================================
        // معالج الحالات
        // ================================
        if (userState.has(userId)) {
            const state = userState.get(userId);

            if (content.toLowerCase() === 'إلغاء') {
                await client.sendMessage(replyTo, `✅ *تم الإلغاء بنجاح!* ✨${signature}`);
                userState.delete(userId);
                return;
            }

            if (userId === OWNER_ID && state.step === 'admin_menu') {
                const option = parseInt(content);
                
                // خريطة التحويل للخيارات
                if (option === 9) { // جدول المحاضرات
                    const res = await db.query('SELECT subject_name, lecture_number, professor_name, group_name, date_added FROM lectures ORDER BY id ASC');
                    if (res.rows.length > 0) {
                        const pdfBuffer = await generateLecturesTablePDF(res.rows);
                        const media = new MessageMedia('application/pdf', pdfBuffer.toString('base64'), `جدول.pdf`);
                        await client.sendMessage(userId, media, { caption: `📊 *جدول المحاضرات*${signature}` });
                    } else {
                         await client.sendMessage(userId, `⚠️ *لا توجد محاضرات مضافة بعد!*${signature}`);
                    }
                    userState.delete(userId); return;
                }
                
                if (option === 10) { // إدارة المحاضرات
                    await client.sendMessage(userId, `📚 *إدارة المحاضرات* 📚
━━━━━━━━━━━━━━━━━━
1️⃣ عرض الكل
2️⃣ تعديل محاضرة
3️⃣ حذف محاضرة

💡 _أرسل الرقم المطلوب:_${signature}`);
                    userState.set(userId, { step: 'lectures_management_menu' }); return;
                }

                if (option === 16) { // بث عام
                    await client.sendMessage(userId, `📢 *بث رسالة عامة*
━━━━━━━━━━━━━━━━━━
أرسل الآن النص الذي ترغب في بثه لجميع المجموعات:${signature}`);
                    userState.set(userId, { step: 'broadcast_message' }); return;
                }

                // تنفيذ الخيارات التي تتطلب اختيار مجموعة (1، 2، 3، 4، 7)
                if ([1, 2, 3, 4, 7, 17].includes(option)) {
                    let groupList = `📋 *اختر المجموعة المطلوبة:*
━━━━━━━━━━━━━━━━━━\n`;
                    let index = 1;
                    const groupsArray = Array.from(groupsMetadata.entries());
                    groupsArray.forEach(([id, name]) => { groupList += `${index++}. 📌 ${name}\n`; });
                    
                    groupList += `\n💡 _أرسل رقم المجموعة أو اكتب_ *إلغاء*`;
                    await client.sendMessage(userId, groupList + signature);
                    userState.set(userId, { step: `admin_option_${option}_select_group` });
                    return;
                }
            }

            // تنفيذ البث
            if (state.step === 'broadcast_message') {
                await client.sendMessage(userId, `⏳ *جاري إرسال الرسائل...*`);
                const chats = await client.getChats();
                const groups = chats.filter(chat => chat.isGroup);
                for (const group of groups) {
                    await client.sendMessage(group.id._serialized, content + signature);
                }
                await client.sendMessage(userId, `✅ *تم البث بنجاح إلى جميع المجموعات!* 🚀${signature}`);
                userState.delete(userId);
                return;
            }
        }

        // --- أوامر PDF الإضافية (إضافة وتحميل) ---
        if (content === '!اضافة_pdf' || content === '!add pdf') {
            if (!isGroupMessage) return;
            await client.sendMessage(replyTo, `📄 *إضافة ملف جديد* 📄
━━━━━━━━━━━━━━━━━━
أهلاً بك! يرجى اختيار نوع الملف الذي تود إضافته:

1️⃣ 📚 محاضرة
2️⃣ 📝 ملخص

💡 _أرسل الرقم المطلوب أو اكتب_ *إلغاء* _للرجوع._${signature}`);
            userState.set(userId, { step: 'select_pdf_type' });
            return;
        }

        if (content === '!تحميل' || content === '!download') {
            if (!isGroupMessage) return;
            await client.sendMessage(replyTo, `📥 *تحميل ملف* 📥
━━━━━━━━━━━━━━━━━━
أهلاً بك! يرجى اختيار نوع الملف الذي تبحث عنه:

1️⃣ 📚 محاضرة
2️⃣ 📝 ملخص

💡 _أرسل الرقم المطلوب أو اكتب_ *إلغاء* _للرجوع._${signature}`);
            userState.set(userId, { step: 'select_pdf_type_for_download' });
            return;
        }

    } catch (error) { console.error(error); }
});

client.initialize();
