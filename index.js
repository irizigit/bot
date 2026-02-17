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

// مسارات الملفات والمجلدات
const blacklistFile = './blacklist.json';
const sectionsFile = './sections.json';
const classesFile = './classes.json';
const groupsFile = './groups.json';
const professorsFile = './professors.json';
const subjectsFile = './subjects.json';

// مجلد دليل الاستخدام (للفيديو والكتاب)
const manualDir = path.join(__dirname, 'manual');
if (!fs.existsSync(manualDir)) {
    fs.mkdirSync(manualDir, { recursive: true });
}

// ============================================
// دوال تحميل وحفظ البيانات
// ============================================
function loadBlacklist() { try { if (fs.existsSync(blacklistFile)) { const data = fs.readFileSync(blacklistFile, 'utf8'); const list = data ? JSON.parse(data) : []; blacklist.clear(); list.forEach(num => blacklist.add(num)); } } catch (e) {} }
function loadSections() { try { if (fs.existsSync(sectionsFile)) { const data = fs.readFileSync(sectionsFile, 'utf8'); const list = data ? JSON.parse(data) : []; sections.clear(); list.forEach(item => sections.set(item.id, item.name)); } } catch (e) {} }
function loadClasses() { try { if (fs.existsSync(classesFile)) { const data = fs.readFileSync(classesFile, 'utf8'); const list = data ? JSON.parse(data) : []; classes.clear(); list.forEach(item => classes.set(item.id, item.name)); } } catch (e) {} }
function loadGroups() { try { if (fs.existsSync(groupsFile)) { const data = fs.readFileSync(groupsFile, 'utf8'); const list = data ? JSON.parse(data) : []; groupsData.clear(); list.forEach(item => groupsData.set(item.id, item.name)); } } catch (e) {} }
function loadProfessors() { try { if (fs.existsSync(professorsFile)) { const data = fs.readFileSync(professorsFile, 'utf8'); const list = data ? JSON.parse(data) : []; professors.clear(); list.forEach(item => professors.set(item.id, item.name)); } } catch (e) {} }
function loadSubjects() { try { if (fs.existsSync(subjectsFile)) { const data = fs.readFileSync(subjectsFile, 'utf8'); const list = data ? JSON.parse(data) : []; subjects.clear(); list.forEach(item => subjects.set(item.id, item.name)); } } catch (e) {} }

function saveBlacklist() { try { fs.writeFileSync(blacklistFile, JSON.stringify([...blacklist])); } catch (e) {} }
function saveSections() { try { const list = Array.from(sections.entries()).map(([id, name]) => ({ id, name })); fs.writeFileSync(sectionsFile, JSON.stringify(list, null, 2)); } catch (e) {} }
function saveClasses() { try { const list = Array.from(classes.entries()).map(([id, name]) => ({ id, name })); fs.writeFileSync(classesFile, JSON.stringify(list, null, 2)); } catch (e) {} }
function saveGroups() { try { const list = Array.from(groupsData.entries()).map(([id, name]) => ({ id, name })); fs.writeFileSync(groupsFile, JSON.stringify(list, null, 2)); } catch (e) {} }
function saveProfessors() { try { const list = Array.from(professors.entries()).map(([id, name]) => ({ id, name })); fs.writeFileSync(professorsFile, JSON.stringify(list, null, 2)); } catch (e) {} }
function saveSubjects() { try { const list = Array.from(subjects.entries()).map(([id, name]) => ({ id, name })); fs.writeFileSync(subjectsFile, JSON.stringify(list, null, 2)); } catch (e) {} }

loadBlacklist(); loadSections(); loadClasses(); loadGroups(); loadProfessors(); loadSubjects();

// توقيع محسّن ومزخرف لرسائل البوت
const signature = "\n\n━━━━━━━━━━━━━━━━━━\n👨‍💻 *Dev by:* IRIZI ✨";

// ============================================
// دوال PDF (للجدول فقط)
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
            if (!checkFonts()) { reject(new Error('الخطوط المطلوبة غير موجودة.')); return; }
            const fonts = { Amiri: { normal: path.join(__dirname, 'fonts/Amiri-Regular.ttf'), bold: path.join(__dirname, 'fonts/Amiri-Bold.ttf') } };
            const printer = new PdfPrinter(fonts);
            const body = [
                [ { text: 'التسلسل', bold: true }, { text: 'المادة', bold: true }, { text: 'رقم المحاضرة', bold: true }, { text: 'الأستاذ', bold: true }, { text: 'الفوج', bold: true }, { text: 'التاريخ', bold: true } ]
            ];
            lecturesData.forEach((lecture, index) => {
                const date = lecture.date_added ? new Date(lecture.date_added).toLocaleDateString('ar-EG') : 'غير محدد';
                body.push([ (index + 1).toString(), lecture.subject_name || '', lecture.lecture_number || '', lecture.professor_name || '', lecture.group_name || '', date ]);
            });
            const docDefinition = {
                defaultStyle: { font: 'Amiri', alignment: 'right', fontSize: 12, textDirection: 'rtl' },
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
client.on('qr', qr => { qrcode.generate(qr, { small: true }); });

client.on('ready', async () => {
    console.log('[✅] Client ready!');
    isBotReady = true;
    const chats = await client.getChats();
    for (const chat of chats) { if (chat.isGroup) { groupsMetadata.set(chat.id._serialized, chat.name); } }
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

        // --- أمر دليل الاستخدام (الفيديو والكتاب المخصص) ---
        if (content === '!دليل' || content === '!مساعدة' || content === '!help') {
            if (!isGroupMessage) return; 
            await message.react('📖');
            
            const pdfPath = path.join(manualDir, 'manual.pdf');
            const videoPath = path.join(manualDir, 'tutorial.mp4');
            
            let filesSent = false;

            // إرسال الفيديو إذا كان موجوداً
            if (fs.existsSync(videoPath)) {
                const videoMedia = MessageMedia.fromFilePath(videoPath);
                await client.sendMessage(replyTo, videoMedia, { caption: `🎥 *فيديو توضيحي لطريقة الاستخدام*${signature}` });
                filesSent = true;
            }

            // إرسال الكتاب (PDF) إذا كان موجوداً
            if (fs.existsSync(pdfPath)) {
                const pdfMedia = MessageMedia.fromFilePath(pdfPath);
                await client.sendMessage(replyTo, pdfMedia, { caption: `📖 *كتاب دليل الاستخدام*\nاقرأ هذا الدليل لمعرفة جميع ميزات البوت وكيفية استغلالها بالشكل الصحيح. ✨${signature}` });
                filesSent = true;
            }

            // إذا لم يقم المدير برفع أي ملف بعد
            if (!filesSent) {
                await client.sendMessage(replyTo, `⚠️ *دليل الاستخدام قيد الإعداد حالياً!*\nيرجى الانتظار حتى يقوم الإدارة برفعه قريباً.${signature}`);
            }
            return;
        }

        // --- أمر تثبيت الرسالة ---
        if (isGroupMessage && content === '!تثبيت' && message.hasQuotedMsg) {
            if (await isAdmin(userId, currentGroupId)) {
                if (await isBotAdmin(currentGroupId)) {
                    const quotedMsg = await message.getQuotedMessage();
                    await quotedMsg.pin();
                    await client.sendMessage(OWNER_ID, `✅ *تم تثبيت الرسالة بنجاح!* ✨${signature}`);
                }
            }
            return;
        }

        // --- أمر التحديث من GitHub ---
        if (!isGroupMessage && userId === OWNER_ID && content === '!تحديث') {
            await message.react('🔄');
            await client.sendMessage(userId, `🔄 *جاري سحب التحديثات من GitHub...*\nسيتم إعادة تشغيل البوت تلقائياً خلال ثوانٍ.${signature}`);
            exec('git pull origin main && pm2 restart all', async (error) => {
                if (error) await client.sendMessage(userId, `⚠️ *حدث خطأ أثناء التحديث:*\n${error.message}${signature}`);
            });
            return;
        }

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
            await client.sendMessage(userId, `🛠️ *لوحة تحكم المدير* 🛠️\n━━━━━━━━━━━━━━━━━━\n\n👥 *الأعضاء والمشرفين:*\n1. ➕ إضافة عضو\n2. ➖ حذف عضو\n3. ⬆️ ترقية عضو\n4. ⬇️ خفض مشرف\n5. 👨‍💻 إضافة مبرمج\n6. ❌ حذف مبرمج\n7. 🧹 تنظيف المجموعة\n\n⚙️ *إدارة المحتوى:*\n8. 📌 تثبيت رسالة\n9. 📊 جدول المحاضرات\n10. 📚 إدارة المحاضرات\n\n🗂️ *إدارة البيانات:*\n11. 🏷️ إدارة الشعب\n12. 🏫 إدارة الفصول\n13. 👥 إدارة الأفواج\n14. 👨‍🏫 إدارة الأساتذة\n15. 📖 إدارة المواد\n\n📢 *التواصل:*\n16. 🌐 بث لجميع المجموعات\n17. 🎯 بث لمجموعة مخصصة\n\n📖 *دليل الاستخدام (للطلاب):*\n18. 📚 رفع/تحديث كتاب الدليل (PDF)\n19. 🎥 رفع/تحديث فيديو الشرح (MP4)\n\n━━━━━━━━━━━━━━━━━━\n💡 _أرسل رقم الخيار لتنفيذه أو اكتب_ *إلغاء* _للخروج._${signature}`);
            userState.set(userId, { step: 'admin_menu', timestamp: Date.now() });
            return;
        }

        // --- أوامر PDF (إضافة وتحميل) ---
        if (content === '!اضافة_pdf' || content === '!add pdf') {
            if (!isGroupMessage) return;
            if (sections.size === 0) { await client.sendMessage(replyTo, `⚠️ *لم يتم إعداد بيانات الشعب بعد!* الرجاء إضافتها من لوحة الإدارة أولاً.${signature}`); return; }
            await client.sendMessage(replyTo, `📄 *إضافة ملف جديد* 📄\n━━━━━━━━━━━━━━━━━━\nأهلاً بك! يرجى اختيار نوع الملف الذي تود إضافته:\n\n1️⃣ 📚 محاضرة\n2️⃣ 📝 ملخص\n\n💡 _أرسل الرقم المطلوب أو اكتب_ *إلغاء* _للرجوع._${signature}`);
            userState.set(userId, { step: 'select_pdf_type' });
            return;
        }

        if (content === '!تحميل' || content === '!download') {
            if (!isGroupMessage) return;
            if (sections.size === 0) { await client.sendMessage(replyTo, `⚠️ *لم يتم إعداد بيانات الشعب بعد!*${signature}`); return; }
            await client.sendMessage(replyTo, `📥 *تحميل ملف* 📥\n━━━━━━━━━━━━━━━━━━\nأهلاً بك! يرجى اختيار نوع الملف الذي تبحث عنه:\n\n1️⃣ 📚 محاضرة\n2️⃣ 📝 ملخص\n\n💡 _أرسل الرقم المطلوب أو اكتب_ *إلغاء* _للرجوع._${signature}`);
            userState.set(userId, { step: 'select_pdf_type_for_download' });
            return;
        }

        // ================================
        // معالج الحالات للعمليات (State Handler)
        // ================================
        if (userState.has(userId)) {
            const state = userState.get(userId);

            if (content.toLowerCase() === 'إلغاء') {
                await client.sendMessage(replyTo, `✅ *تم الإلغاء بنجاح!* ✨${signature}`);
                userState.delete(userId);
                return;
            }

            // ------------------------------------
            // رفع ملفات الدليل (من الإدارة)
            // ------------------------------------
            if (state.step === 'waiting_for_manual_pdf') {
                if (message.hasMedia && message.type === 'document') {
                    const media = await message.downloadMedia();
                    if (media.mimetype === 'application/pdf') {
                        await message.react('⏳');
                        fs.writeFileSync(path.join(manualDir, 'manual.pdf'), Buffer.from(media.data, 'base64'));
                        await client.sendMessage(replyTo, `✅ *تم حفظ كتاب الدليل (PDF) بنجاح!* ✨\nيمكن للطلاب الآن استدعاءه بأمر !دليل.${signature}`);
                        await message.react('✅');
                    } else { await client.sendMessage(replyTo, `⚠️ *يرجى إرسال ملف بصيغة PDF فقط!*${signature}`); }
                } else { await client.sendMessage(replyTo, `⚠️ *لم تقم بإرسال أي ملف PDF.* يرجى المحاولة مرة أخرى.${signature}`); }
                userState.delete(userId);
                return;
            }

            if (state.step === 'waiting_for_manual_video') {
                if (message.hasMedia && message.type === 'video') {
                    await message.react('⏳');
                    const media = await message.downloadMedia();
                    fs.writeFileSync(path.join(manualDir, 'tutorial.mp4'), Buffer.from(media.data, 'base64'));
                    await client.sendMessage(replyTo, `✅ *تم حفظ فيديو الشرح بنجاح!* ✨\nسيتم إرساله للطلاب مع أمر !دليل.${signature}`);
                    await message.react('✅');
                } else { await client.sendMessage(replyTo, `⚠️ *لم تقم بإرسال أي فيديو.* يرجى المحاولة مرة أخرى.${signature}`); }
                userState.delete(userId);
                return;
            }

            // ------------------------------------
            // عمليات إضافة PDF (الطلاب)
            // ------------------------------------
            if (state.step === 'select_pdf_type') {
                const option = parseInt(content);
                if (option !== 1 && option !== 2) { await client.sendMessage(replyTo, `⚠️ *خيار غير صحيح!* يرجى اختيار 1 للمحاضرة أو 2 للملخص.${signature}`); return; }
                state.pdfType = option === 1 ? 'محاضرة' : 'ملخص';
                state.step = 'select_section';
                userState.set(userId, state);
                let sectionsList = `📚 *اختر الشعبة:*\n━━━━━━━━━━━━━━━━━━\n`; let index = 1;
                for (const [id, name] of sections) { sectionsList += `${index++}. ${name}\n`; }
                await client.sendMessage(replyTo, sectionsList + `\n💡 _أرسل رقم الشعبة أو اكتب_ *إلغاء*${signature}`);
                return;
            }

            if (state.step === 'select_section') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > sections.size) { await client.sendMessage(replyTo, `⚠️ *خيار غير صحيح!* يرجى اختيار رقم الشعبة الصحيح.${signature}`); return; }
                const sectionId = Array.from(sections.keys())[option - 1];
                state.sectionId = sectionId; state.sectionName = sections.get(sectionId); state.step = 'waiting_form'; userState.set(userId, state);
                await client.sendMessage(replyTo, `✅ *رائع!* يرجى نسخ الاستمارة التالية وملئها بدقة:\n\nرقم ${state.pdfType}: \nاسم الفصل: \nالمادة: \nالأستاذ: \nالفوج: \n\n⚠️ *ملاحظة:* املأ البيانات بعد النقطتين (:) ثم أرسلها في رسالة واحدة.${signature}`);
                return;
            }

            if (state.step === 'waiting_form') {
                const lines = content.split('\n'); const info = {};
                lines.forEach(line => {
                    if (line.includes('رقم')) info.number = line.split(':')[1]?.trim();
                    if (line.includes('الفصل')) info.className = line.split(':')[1]?.trim();
                    if (line.includes('المادة')) info.subject = line.split(':')[1]?.trim();
                    if (line.includes('الأستاذ') || line.includes('الاستاد')) info.professor = line.split(':')[1]?.trim();
                    if (line.includes('الفوج')) info.group = line.split(':')[1]?.trim();
                });
                if (!info.number || !info.className || !info.subject || !info.professor || !info.group) { await client.sendMessage(replyTo, `⚠️ *الاستمارة ناقصة!* يرجى ملء كافة البيانات.${signature}`); return; }
                state.formData = info; state.step = 'waiting_pdf'; userState.set(userId, state);
                await client.sendMessage(replyTo, `✅ *تم استلام البيانات.* يرجى الآن إرسال ملف الـ *PDF* المطلوب.${signature}`);
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
                            await db.query(query, [state.pdfType, state.sectionId, state.sectionName, state.formData.className, state.formData.subject, state.formData.professor, state.formData.group, state.formData.number, messageId, userId, new Date().toISOString(), media.filename || `${state.pdfType}.pdf`]);

                            // إضافة للبيانات التلقائية
                            let newItemsAdded = [];
                            const className = state.formData.className.trim();
                            if (className && !Array.from(classes.values()).includes(className)) { classes.set(Date.now().toString(), className); saveClasses(); newItemsAdded.push(`🏫 فصل: ${className}`); }
                            const groupName = state.formData.group.trim();
                            if (groupName && !Array.from(groupsData.values()).includes(groupName)) { groupsData.set(Date.now().toString() + '_g', groupName); saveGroups(); newItemsAdded.push(`👥 فوج: ${groupName}`); }
                            const professorName = state.formData.professor.trim();
                            if (professorName && !Array.from(professors.values()).includes(professorName)) { professors.set(Date.now().toString() + '_p', professorName); saveProfessors(); newItemsAdded.push(`👨‍🏫 أستاذ: ${professorName}`); }
                            const subjectName = state.formData.subject.trim();
                            if (subjectName && !Array.from(subjects.values()).includes(subjectName)) { subjects.set(Date.now().toString() + '_s', subjectName); saveSubjects(); newItemsAdded.push(`📖 مادة: ${subjectName}`); }

                            let successMsg = `✅ *تم الحفظ بنجاح!* ✨\nتم تأمين الملف في قاعدة البيانات.`;
                            if (newItemsAdded.length > 0) successMsg += `\n\n🆕 *تم إضافة عناصر جديدة تلقائياً:*\n${newItemsAdded.join('\n')}`;
                            await client.sendMessage(replyTo, successMsg + signature);
                            userState.delete(userId); await message.react('✅');
                        } catch (err) {
                            await client.sendMessage(replyTo, `⚠️ *حدث خطأ أثناء الحفظ في القاعدة!* تم الرفع للأرشيف فقط.${signature}`);
                            userState.delete(userId);
                        }
                    } else { await client.sendMessage(replyTo, `⚠️ *يرجى إرسال ملف PDF فقط!*${signature}`); }
                } else { await client.sendMessage(replyTo, `⚠️ *يرجى إرسال ملف PDF!*${signature}`); }
                return;
            }

            // ------------------------------------
            // عمليات تحميل PDF (الطلاب)
            // ------------------------------------
            if (state.step === 'select_pdf_type_for_download') {
                const option = parseInt(content);
                if (option !== 1 && option !== 2) return await client.sendMessage(replyTo, `⚠️ *خيار غير صحيح!*${signature}`);
                state.pdfType = option === 1 ? 'محاضرة' : 'ملخص'; state.step = 'select_section_for_download'; userState.set(userId, state);
                let sectionsList = `📚 *اختر الشعبة:*\n━━━━━━━━━━━━━━━━━━\n`; let index = 1;
                for (const [id, name] of sections) { sectionsList += `${index++}. ${name}\n`; }
                await client.sendMessage(replyTo, sectionsList + `\n💡 _أرسل رقم الشعبة أو اكتب_ *إلغاء*${signature}`);
                return;
            }

            if (state.step === 'select_section_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > sections.size) return await client.sendMessage(replyTo, `⚠️ *خيار غير صحيح!*${signature}`);
                const sectionId = Array.from(sections.keys())[option - 1]; state.sectionName = sections.get(sectionId);
                try {
                    const query = `SELECT DISTINCT class_name FROM lectures WHERE type = $1 AND section_name = $2`;
                    const res = await db.query(query, [state.pdfType, state.sectionName]);
                    if (res.rows.length === 0) { await client.sendMessage(replyTo, `⚠️ لا توجد ${state.pdfType} متوفرة لشعبة "${state.sectionName}".${signature}`); userState.delete(userId); return; }
                    state.availableClasses = res.rows.map(row => row.class_name); state.step = 'select_class_for_download'; userState.set(userId, state);
                    let classesList = `🏫 *اختر الفصل:*\n━━━━━━━━━━━━━━━━━━\n`;
                    state.availableClasses.forEach((className, index) => { classesList += `${index + 1}. الفصل: ${className}\n`; });
                    await client.sendMessage(replyTo, classesList + `\n💡 _أرسل رقم الفصل أو اكتب_ *إلغاء*${signature}`);
                } catch (err) { userState.delete(userId); }
                return;
            }

            if (state.step === 'select_class_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > state.availableClasses.length) return await client.sendMessage(replyTo, `⚠️ *خيار غير صحيح!*${signature}`);
                state.className = state.availableClasses[option - 1];
                try {
                    const query = `SELECT * FROM lectures WHERE type = $1 AND section_name = $2 AND class_name = $3 ORDER BY id DESC`;
                    const res = await db.query(query, [state.pdfType, state.sectionName, state.className]);
                    if (res.rows.length === 0) { await client.sendMessage(replyTo, `⚠️ لا توجد ملفات متوفرة.${signature}`); userState.delete(userId); return; }
                    state.availableLectures = res.rows; state.step = 'select_lecture_for_download'; userState.set(userId, state);
                    let lecturesList = `📄 *قائمة الملفات المتوفرة:*\n━━━━━━━━━━━━━━━━━━\n`;
                    res.rows.forEach((lecture, index) => { lecturesList += `${index + 1}. 📖 ${lecture.subject_name} | 📝 رقم: ${lecture.lecture_number}\n   👨‍🏫 الأستاذ: ${lecture.professor_name}\n\n`; });
                    await client.sendMessage(replyTo, lecturesList + `💡 _أرسل رقم الملف لتحميله أو اكتب_ *إلغاء*${signature}`);
                } catch (err) { userState.delete(userId); }
                return;
            }

            if (state.step === 'select_lecture_for_download') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > state.availableLectures.length) return await client.sendMessage(replyTo, `⚠️ *خيار غير صحيح!*${signature}`);
                const lecture = state.availableLectures[option - 1];
                try {
                    const media = await client.getMessageById(lecture.message_id);
                    if (media && media.hasMedia) {
                        const mediaData = await media.downloadMedia();
                        await client.sendMessage(replyTo, mediaData, { caption: `📄 ${lecture.subject_name} - ${lecture.type} ${lecture.lecture_number}${signature}` });
                        await message.react('✅');
                    } else { await client.sendMessage(replyTo, `⚠️ *الملف غير متاح في الأرشيف!*${signature}`); }
                } catch (err) { await client.sendMessage(replyTo, `⚠️ *حدث خطأ أثناء تحميل الملف!*${signature}`); }
                userState.delete(userId); return;
            }

            // ------------------------------------
            // لوحة الإدارة
            // ------------------------------------
            if (userId === OWNER_ID && state.step === 'admin_menu') {
                const option = parseInt(content);
                
                // إضافة / حذف مبرمج
                if (option === 5) { await client.sendMessage(userId, `📞 *أرسل رقم المبرمج الجديد* (مثال: 212600000000):${signature}`); userState.set(userId, { step: 'add_dev_number' }); return; }
                if (option === 6) { await client.sendMessage(userId, `📞 *أرسل رقم المبرمج لإزالته* (مثال: 212600000000):${signature}`); userState.set(userId, { step: 'remove_dev_number' }); return; }

                if (option === 8) { await client.sendMessage(userId, `📌 *لتثبيت رسالة:*\nفي المجموعة، اعمل "رد/Reply" للرسالة المطلوبة واكتب الأمر:\n*!تثبيت*${signature}`); userState.delete(userId); return; }

                if (option === 9) {
                    const res = await db.query('SELECT subject_name, lecture_number, professor_name, group_name, date_added FROM lectures ORDER BY id ASC');
                    if (res.rows.length > 0) { const pdfBuffer = await generateLecturesTablePDF(res.rows); const media = new MessageMedia('application/pdf', pdfBuffer.toString('base64'), `جدول.pdf`); await client.sendMessage(userId, media, { caption: `📊 *جدول المحاضرات*${signature}` }); } 
                    else { await client.sendMessage(userId, `⚠️ *لا توجد محاضرات مضافة بعد!*${signature}`); }
                    userState.delete(userId); return;
                }
                
                if (option === 10) { await client.sendMessage(userId, `📚 *إدارة المحاضرات* 📚\n━━━━━━━━━━━━━━━━━━\n1️⃣ عرض الكل\n2️⃣ تعديل محاضرة\n3️⃣ حذف محاضرة\n\n💡 _أرسل الرقم المطلوب:_${signature}`); userState.set(userId, { step: 'lectures_management_menu' }); return; }
                if (option === 11) { await client.sendMessage(userId, `🏷️ *إدارة الشعب* 🏷️\n━━━━━━━━━━━━━━━━━━\n1️⃣ عرض الكل\n2️⃣ إضافة شعبة جديدة\n3️⃣ تعديل شعبة\n4️⃣ حذف شعبة\n\n💡 _أرسل الرقم المطلوب:_${signature}`); userState.set(userId, { step: 'sections_management_menu' }); return; }

                // القوائم التلقائية (12-15)
                if (option >= 12 && option <= 15) {
                    const maps = { 12: 'classes', 13: 'groups', 14: 'professors', 15: 'subjects' };
                    const titles = { 12: 'الفصول', 13: 'الأفواج', 14: 'الأساتذة', 15: 'المواد' };
                    await client.sendMessage(userId, `📋 *إدارة ${titles[option]}*\n━━━━━━━━━━━━━━━━━━\n1️⃣ عرض الكل\n2️⃣ حذف عنصر\n\n💡 _أرسل الرقم المطلوب:_${signature}`);
                    userState.set(userId, { step: `${maps[option]}_auto_management_menu` }); return;
                }

                if (option === 16) { await client.sendMessage(userId, `📢 *بث رسالة عامة*\n━━━━━━━━━━━━━━━━━━\nأرسل الآن النص الذي ترغب في بثه لجميع المجموعات:${signature}`); userState.set(userId, { step: 'broadcast_message' }); return; }

                // خيارات الدليل الجديدة (18، 19)
                if (option === 18) {
                    await client.sendMessage(userId, `📚 *رفع كتاب الدليل*\n━━━━━━━━━━━━━━━━━━\nأرسل الآن ملف الـ *PDF* الخاص بكتاب دليل الاستخدام.\n(سيتم استبدال الملف القديم إذا كان موجوداً)${signature}`);
                    userState.set(userId, { step: 'waiting_for_manual_pdf' });
                    return;
                }
                
                if (option === 19) {
                    await client.sendMessage(userId, `🎥 *رفع فيديو الشرح*\n━━━━━━━━━━━━━━━━━━\nأرسل الآن ملف الـ *Video (MP4)* الخاص بشرح الاستخدام.\n⚠️ ملاحظة: يُفضل أن لا يتجاوز حجم الفيديو 16 ميغابايت لتجنب مشاكل الإرسال في الواتساب.${signature}`);
                    userState.set(userId, { step: 'waiting_for_manual_video' });
                    return;
                }

                // تنفيذ الخيارات التي تتطلب اختيار مجموعة (1, 2, 3, 4, 7, 17)
                if ([1, 2, 3, 4, 7, 17].includes(option)) {
                    let groupList = `📋 *اختر المجموعة المطلوبة:*\n━━━━━━━━━━━━━━━━━━\n`; let index = 1;
                    const groupsArray = Array.from(groupsMetadata.entries());
                    groupsArray.forEach(([id, name]) => { groupList += `${index++}. 📌 ${name}\n`; });
                    groupList += `\n💡 _أرسل رقم المجموعة أو اكتب_ *إلغاء*`;
                    await client.sendMessage(userId, groupList + signature);
                    userState.set(userId, { step: `admin_option_${option}_select_group` }); return;
                }
            }

            // ------------------------------------
            // تنفيذ الأوامر الإدارية (داخل المجموعات والمبرمجين)
            // ------------------------------------
            if (state.step && state.step.startsWith('admin_option_')) {
                const match = state.step.match(/admin_option_(\d+)_select_group/);
                if (match) {
                    const opt = parseInt(match[1]); const groupIndex = parseInt(content) - 1; const groupsArray = Array.from(groupsMetadata.entries());
                    if (isNaN(groupIndex) || groupIndex < 0 || groupIndex >= groupsArray.length) { return await client.sendMessage(userId, `⚠️ *اختيار خاطئ للمجموعة!*${signature}`); }
                    const selectedGroupId = groupsArray[groupIndex][0];

                    if (opt === 7) { 
                        await client.sendMessage(userId, `🧹 *جاري تنظيف المجموعة من الأعضاء المحظورين...*`); let kicked = 0;
                        try {
                            const chat = await client.getChatById(selectedGroupId);
                            for (const participant of chat.participants) { if (blacklist.has(participant.id._serialized)) { await chat.removeParticipants([participant.id._serialized]); kicked++; } }
                            await client.sendMessage(userId, `✅ *تم التنظيف!* طُرد ${kicked} عضو محظور.${signature}`);
                        } catch (e) { await client.sendMessage(userId, `⚠️ *خطأ!* تأكد أن البوت مشرف.${signature}`); }
                        userState.delete(userId); return;
                    }
                    if (opt === 17) { await client.sendMessage(userId, `📝 *أرسل الرسالة التي تود بثها في المجموعة المحددة:*${signature}`); userState.set(userId, { step: 'broadcast_to_selected_group', broadcastGroupId: selectedGroupId }); return; }

                    const actions = { 1: 'إضافته', 2: 'حذفه', 3: 'ترقيته', 4: 'خفض رتبته' };
                    await client.sendMessage(userId, `📞 *أرسل رقم العضو المراد ${actions[opt]}* (مثال: 212600000000):${signature}`);
                    userState.set(userId, { step: `admin_execute_${opt}`, groupId: selectedGroupId }); return;
                }
            }

            if (state.step && state.step.startsWith('admin_execute_')) {
                const match = state.step.match(/admin_execute_(\d+)/);
                if (match) {
                    const opt = parseInt(match[1]); const targetNumber = content.replace(/\D/g, '') + '@c.us';
                    try {
                        const chat = await client.getChatById(state.groupId);
                        if (opt === 1) await chat.addParticipants([targetNumber]);
                        if (opt === 2) await chat.removeParticipants([targetNumber]);
                        if (opt === 3) await chat.promoteParticipants([targetNumber]);
                        if (opt === 4) await chat.demoteParticipants([targetNumber]);
                        await client.sendMessage(userId, `✅ *تمت العملية بنجاح!* ✨${signature}`);
                    } catch (err) { await client.sendMessage(userId, `⚠️ *حدث خطأ!* تأكد أن البوت مشرف والرقم صحيح.${signature}`); }
                    userState.delete(userId); return;
                }
            }

            if (state.step === 'add_dev_number') { admins.add(content.replace(/\D/g, '') + '@c.us'); await client.sendMessage(userId, `✅ *تم إضافة المبرمج بنجاح!* ✨${signature}`); userState.delete(userId); return; }
            if (state.step === 'remove_dev_number') { admins.delete(content.replace(/\D/g, '') + '@c.us'); await client.sendMessage(userId, `✅ *تم إزالة المبرمج بنجاح!* ✨${signature}`); userState.delete(userId); return; }

            if (state.step === 'broadcast_message') {
                await client.sendMessage(userId, `⏳ *جاري الإرسال...*`); const chats = await client.getChats(); const groups = chats.filter(chat => chat.isGroup);
                for (const group of groups) { await client.sendMessage(group.id._serialized, content + signature); }
                await client.sendMessage(userId, `✅ *تم البث بنجاح إلى جميع المجموعات!* 🚀${signature}`); userState.delete(userId); return;
            }
            if (state.step === 'broadcast_to_selected_group') {
                try { await client.sendMessage(state.broadcastGroupId, content + signature); await client.sendMessage(userId, `✅ *تم إرسال الرسالة!* ✨${signature}`); } 
                catch (e) { await client.sendMessage(userId, `⚠️ *فشل الإرسال.*${signature}`); }
                userState.delete(userId); return;
            }

            // إدارة المحاضرات (10)
            if (state.step === 'lectures_management_menu') {
                const opt = parseInt(content);
                if (opt === 1) {
                    const res = await db.query('SELECT * FROM lectures ORDER BY id ASC'); let list = `📋 *جميع المحاضرات:*\n━━━━━━━━━━━━━━━━━━\n`;
                    if (res.rows.length === 0) list += `⚠️ لا توجد محاضرات مضافة!\n`;
                    res.rows.forEach((l, i) => { list += `${i + 1}. ${l.subject_name} - ${l.type} ${l.lecture_number}\n`; });
                    await client.sendMessage(userId, list + signature); userState.delete(userId); return;
                }
                if (opt === 2 || opt === 3) {
                    const res = await db.query('SELECT * FROM lectures ORDER BY id ASC'); state.adminLectures = res.rows;
                    let list = opt === 2 ? `✏️ *اختر محاضرة للتعديل:*\n━━━━━━━━━━━━━━━━━━\n` : `🗑️ *اختر محاضرة للحذف:*\n━━━━━━━━━━━━━━━━━━\n`;
                    res.rows.forEach((l, i) => { list += `${i + 1}. ${l.subject_name} - ${l.type} ${l.lecture_number}\n`; });
                    await client.sendMessage(userId, list + `\n💡 _أرسل الرقم:_`); userState.set(userId, { step: opt === 2 ? 'edit_lecture_select' : 'delete_lecture_select', adminLectures: res.rows }); return;
                }
            }
            if (state.step === 'edit_lecture_select') {
                const idx = parseInt(content) - 1; if (isNaN(idx) || idx < 0 || idx >= state.adminLectures.length) return; const lecture = state.adminLectures[idx];
                await client.sendMessage(userId, `✏️ *تعديل محاضرة*\nأرسل المعلومات الجديدة:\n\nاسم المادة: \nرقم: \nالأستاذ: \nالفوج: \nالفصل: \nالشعبة: \n${signature}`);
                userState.set(userId, { step: 'edit_lecture_data', dbId: lecture.id }); return;
            }
            if (state.step === 'edit_lecture_data') {
                const lines = content.split('\n'); const info = {};
                lines.forEach(l => {
                    if (l.includes('اسم المادة')) info.subject = l.split(':')[1]?.trim(); if (l.includes('رقم')) info.number = l.split(':')[1]?.trim();
                    if (l.includes('الأستاذ')) info.professor = l.split(':')[1]?.trim(); if (l.includes('الفوج')) info.group = l.split(':')[1]?.trim();
                    if (l.includes('الفصل')) info.className = l.split(':')[1]?.trim(); if (l.includes('الشعبة')) info.section = l.split(':')[1]?.trim();
                });
                try { await db.query(`UPDATE lectures SET subject_name=$1, lecture_number=$2, professor_name=$3, group_name=$4, class_name=$5, section_name=$6 WHERE id=$7`, [info.subject, info.number, info.professor, info.group, info.className, info.section, state.dbId]); await client.sendMessage(userId, `✅ *تم التعديل بنجاح!* ✨${signature}`); } 
                catch (e) { await client.sendMessage(userId, `⚠️ خطأ!`); } userState.delete(userId); return;
            }
            if (state.step === 'delete_lecture_select') {
                const idx = parseInt(content) - 1; if (isNaN(idx) || idx < 0 || idx >= state.adminLectures.length) return; const lecture = state.adminLectures[idx];
                await client.sendMessage(userId, `🗑️ *متأكد من حذف ${lecture.subject_name}؟* (نعم/لا)${signature}`); userState.set(userId, { step: 'delete_lecture_confirm', dbId: lecture.id }); return;
            }
            if (state.step === 'delete_lecture_confirm') {
                if (content.toLowerCase() === 'نعم') { try { await db.query(`DELETE FROM lectures WHERE id=$1`, [state.dbId]); await client.sendMessage(userId, `✅ *تم الحذف!* ✨${signature}`); } catch (e) { await client.sendMessage(userId, `⚠️ خطأ!`); } }
                userState.delete(userId); return;
            }

            // إدارة الشعب (11)
            if (state.step === 'sections_management_menu') {
                const opt = parseInt(content);
                if (opt === 1) { let list = `📋 *جميع الشعب:*\n━━━━━━━━━━━━━━━━━━\n`; sections.forEach((n, id) => { list += `- ${n}\n`; }); await client.sendMessage(userId, list + signature); userState.delete(userId); return; }
                if (opt === 2) { await client.sendMessage(userId, `➕ *أرسل اسم الشعبة الجديدة:*${signature}`); userState.set(userId, { step: 'add_sections' }); return; }
                if (opt === 3 || opt === 4) { let list = opt === 3 ? `✏️ *اختر الشعبة للتعديل:*\n` : `🗑️ *اختر الشعبة للحذف:*\n`; let index = 1; const arr = []; sections.forEach((n, id) => { list += `${index++}. ${n}\n`; arr.push(id); }); await client.sendMessage(userId, list + `\n💡 _أرسل الرقم:_`); userState.set(userId, { step: opt === 3 ? 'edit_sections_select' : 'delete_sections_select', items: arr }); return; }
            }
            if (state.step === 'add_sections') { sections.set(Date.now().toString(), content.trim()); saveSections(); await client.sendMessage(userId, `✅ *تم إضافة الشعبة!* ✨${signature}`); userState.delete(userId); return; }
            if (state.step === 'edit_sections_select') { const id = state.items[parseInt(content) - 1]; if (!id) return; await client.sendMessage(userId, `✏️ *أرسل الاسم الجديد:*${signature}`); userState.set(userId, { step: 'edit_sections_data', editId: id }); return; }
            if (state.step === 'edit_sections_data') { sections.set(state.editId, content.trim()); saveSections(); await client.sendMessage(userId, `✅ *تم التعديل!* ✨${signature}`); userState.delete(userId); return; }
            if (state.step === 'delete_sections_select') { const id = state.items[parseInt(content) - 1]; if (!id) return; await client.sendMessage(userId, `🗑️ *متأكد من الحذف؟* (نعم/لا)${signature}`); userState.set(userId, { step: 'delete_sections_confirm', delId: id }); return; }
            if (state.step === 'delete_sections_confirm') { if (content.toLowerCase() === 'نعم') { sections.delete(state.delId); saveSections(); await client.sendMessage(userId, `✅ *تم الحذف!* ✨${signature}`); } userState.delete(userId); return; }

            // الإدارة التلقائية (12-15)
            const autoDataMenus = { 'classes': { map: classes, save: saveClasses, title: 'الفصول' }, 'groups': { map: groupsData, save: saveGroups, title: 'الأفواج' }, 'professors': { map: professors, save: saveProfessors, title: 'الأساتذة' }, 'subjects': { map: subjects, save: saveSubjects, title: 'المواد' } };
            for (const [key, data] of Object.entries(autoDataMenus)) {
                if (state.step === `${key}_auto_management_menu`) {
                    if (parseInt(content) === 1) { let list = `📋 *جميع ${data.title}:*\n━━━━━━━━━━━━━━━━━━\n`; data.map.forEach((n) => { list += `- ${n}\n`; }); await client.sendMessage(userId, list + signature); userState.delete(userId); return; }
                    if (parseInt(content) === 2) { let list = `🗑️ *اختر للحذف:*\n━━━━━━━━━━━━━━━━━━\n`; let index = 1; const arr = []; data.map.forEach((n, id) => { list += `${index++}. ${n}\n`; arr.push({ id, n }); }); await client.sendMessage(userId, list + `\n💡 _أرسل الرقم:_`); userState.set(userId, { step: `delete_auto_${key}_select`, items: arr }); return; }
                }
                if (state.step === `delete_auto_${key}_select`) { const item = state.items[parseInt(content) - 1]; if (!item) return; await client.sendMessage(userId, `🗑️ *متأكد من حذف "${item.n}"؟* (نعم/لا)${signature}`); userState.set(userId, { step: `delete_auto_${key}_confirm`, delId: item.id }); return; }
                if (state.step === `delete_auto_${key}_confirm`) { if (content.toLowerCase() === 'نعم') { data.map.delete(state.delId); data.save(); await client.sendMessage(userId, `✅ *تم الحذف!* ✨${signature}`); } userState.delete(userId); return; }
            }

        }
    } catch (error) { console.error(error); }
});

client.initialize();
