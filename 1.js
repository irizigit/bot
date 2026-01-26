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
const sections = new Map(); // Ø§ÙØ´Ø¹Ø¨
const classes = new Map(); // Ø§ÙÙØµÙÙ
const groupsData = new Map(); // Ø§ÙØ£ÙÙØ§Ø¬
const professors = new Map(); // Ø§ÙØ£Ø³Ø§ØªØ°Ø©
const subjects = new Map(); // Ø§ÙÙÙØ§Ø¯

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
            console.log(`[ð] Loaded ${lecturesMetadata.length} lectures`);
        } else {
            lecturesMetadata = [];
            fs.writeFileSync(lecturesFile, JSON.stringify([]));
        }
    } catch (error) {
        console.error('[â] Error loading lectures:', error);
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
            console.log(`[ð] Loaded stats`);
        }
    } catch (error) {
        console.error('[â] Error loading stats:', error);
    }
}

function loadBlacklist() {
    try {
        if (fs.existsSync(blacklistFile)) {
            const data = fs.readFileSync(blacklistFile, 'utf8');
            const list = data ? JSON.parse(data) : [];
            blacklist.clear();
            list.forEach(num => blacklist.add(num));
            console.log(`[ð] Loaded ${blacklist.size} blacklisted numbers`);
        }
    } catch (error) {
        console.error('[â] Error loading blacklist:', error);
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
            console.log(`[ð] Loaded ${sections.size} sections`);
        }
    } catch (error) {
        console.error('[â] Error loading sections:', error);
    }
}

function loadClasses() {
    try {
        if (fs.existsSync(classesFile)) {
            const data = fs.readFileSync(classesFile, 'utf8');
            const list = data ? JSON.parse(data) : [];
            classes.clear();
            list.forEach(item => classes.set(item.id, item.name));
            console.log(`[ð] Loaded ${classes.size} classes`);
        }
    } catch (error) {
        console.error('[â] Error loading classes:', error);
    }
}

function loadGroups() {
    try {
        if (fs.existsSync(groupsFile)) {
            const data = fs.readFileSync(groupsFile, 'utf8');
            const list = data ? JSON.parse(data) : [];
            groupsData.clear();
            list.forEach(item => groupsData.set(item.id, item.name));
            console.log(`[ð] Loaded ${groupsData.size} groups`);
        }
    } catch (error) {
        console.error('[â] Error loading groups:', error);
    }
}

function loadProfessors() {
    try {
        if (fs.existsSync(professorsFile)) {
            const data = fs.readFileSync(professorsFile, 'utf8');
            const list = data ? JSON.parse(data) : [];
            professors.clear();
            list.forEach(item => professors.set(item.id, item.name));
            console.log(`[ð] Loaded ${professors.size} professors`);
        }
    } catch (error) {
        console.error('[â] Error loading professors:', error);
    }
}

function loadSubjects() {
    try {
        if (fs.existsSync(subjectsFile)) {
            const data = fs.readFileSync(subjectsFile, 'utf8');
            const list = data ? JSON.parse(data) : [];
            subjects.clear();
            list.forEach(item => subjects.set(item.id, item.name));
            console.log(`[ð] Loaded ${subjects.size} subjects`);
        }
    } catch (error) {
        console.error('[â] Error loading subjects:', error);
    }
}

function saveLectures() {
    try {
        fs.writeFileSync(lecturesFile, JSON.stringify(lecturesMetadata, null, 2));
        console.log('[ð¾] Saved lectures');
    } catch (error) {
        console.error('[â] Error saving lectures:', error);
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
        console.log('[ð¾] Saved stats');
    } catch (error) {
        console.error('[â] Error saving stats:', error);
    }
}

function saveBlacklist() {
    try {
        fs.writeFileSync(blacklistFile, JSON.stringify([...blacklist]));
        console.log('[ð¾] Saved blacklist');
    } catch (error) {
        console.error('[â] Error saving blacklist:', error);
    }
}

// New save functions
function saveSections() {
    try {
        const list = Array.from(sections.entries()).map(([id, name]) => ({ id, name }));
        fs.writeFileSync(sectionsFile, JSON.stringify(list, null, 2));
        console.log('[ð¾] Saved sections');
    } catch (error) {
        console.error('[â] Error saving sections:', error);
    }
}

function saveClasses() {
    try {
        const list = Array.from(classes.entries()).map(([id, name]) => ({ id, name }));
        fs.writeFileSync(classesFile, JSON.stringify(list, null, 2));
        console.log('[ð¾] Saved classes');
    } catch (error) {
        console.error('[â] Error saving classes:', error);
    }
}

function saveGroups() {
    try {
        const list = Array.from(groupsData.entries()).map(([id, name]) => ({ id, name }));
        fs.writeFileSync(groupsFile, JSON.stringify(list, null, 2));
        console.log('[ð¾] Saved groups');
    } catch (error) {
        console.error('[â] Error saving groups:', error);
    }
}

function saveProfessors() {
    try {
        const list = Array.from(professors.entries()).map(([id, name]) => ({ id, name }));
        fs.writeFileSync(professorsFile, JSON.stringify(list, null, 2));
        console.log('[ð¾] Saved professors');
    } catch (error) {
        console.error('[â] Error saving professors:', error);
    }
}

function saveSubjects() {
    try {
        const list = Array.from(subjects.entries()).map(([id, name]) => ({ id, name }));
        fs.writeFileSync(subjectsFile, JSON.stringify(list, null, 2));
        console.log('[ð¾] Saved subjects');
    } catch (error) {
        console.error('[â] Error saving subjects:', error);
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

const signature = "\nð¨âð» *dev by: IRIZI ð*";

// Ø¯Ø§ÙØ© ÙÙØªÙØ§ØµÙ ÙØ¹ Gemini API
async function askGemini(prompt, context = '') {
    try {
        const fullPrompt = context ? `${context}\n\nØ§ÙØ³Ø¤Ø§Ù: ${prompt}` : prompt;
        
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
            return "Ø¹Ø°Ø±Ø§ÙØ ÙÙ Ø£ØªÙÙÙ ÙÙ Ø§ÙØ­ØµÙÙ Ø¹ÙÙ Ø¥Ø¬Ø§Ø¨Ø© ÙÙ Ø§ÙØ°ÙØ§Ø¡ Ø§ÙØ§ØµØ·ÙØ§Ø¹Ù.";
        }
    } catch (error) {
        console.error('[â] Error calling Gemini API:', error);
        return "Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ Ø§ÙØ§ØªØµØ§Ù Ø¨Ø§ÙØ°ÙØ§Ø¡ Ø§ÙØ§ØµØ·ÙØ§Ø¹Ù.";
    }
}

// Ø¯Ø§ÙØ© ÙØªØ­ÙÙÙ ÙÙØ© Ø§ÙÙØ³ØªØ®Ø¯Ù Ø¨Ø§Ø³ØªØ®Ø¯Ø§Ù Gemini
async function analyzeUserIntent(message, senderName, isGroup, groupName = '') {
    try {
        const context = `
Ø£ÙØª ÙØ³Ø§Ø¹Ø¯ Ø°ÙØ§Ø¡ Ø§ØµØ·ÙØ§Ø¹Ù ÙØ¨ÙØª WhatsApp. ÙÙÙØªÙ ÙÙ ØªØ­ÙÙÙ ÙÙØ© Ø§ÙÙØ³ØªØ®Ø¯Ù ÙÙ Ø±Ø³Ø§ÙØªÙ ÙØ§ÙØ±Ø¯ Ø¨Ø´ÙÙ ÙÙØ§Ø³Ø¨.

Ø§ÙÙØ¹ÙÙÙØ§Øª Ø§ÙÙØªØ§Ø­Ø©:
- Ø§Ø³Ù Ø§ÙÙØ±Ø³Ù: ${senderName}
- Ø§ÙØ±Ø³Ø§ÙØ© ÙÙ ÙØ¬ÙÙØ¹Ø©: ${isGroup ? 'ÙØ¹Ù' : 'ÙØ§'}
${isGroup ? `- Ø§Ø³Ù Ø§ÙÙØ¬ÙÙØ¹Ø©: ${groupName}` : ''}
- Ø§ÙØ±Ø³Ø§ÙØ©: ${message}

Ø§ÙØ±Ø¯ ÙØ¬Ø¨ Ø£Ù ÙÙÙÙ Ø¨ØªÙØ³ÙÙ JSON ÙØ­ØªÙÙ Ø¹ÙÙ:
{
  "intent": "Ø§ÙÙÙØ© (ÙØ«Ù: Ø³Ø¤Ø§ÙØ Ø´ÙÙÙØ Ø·ÙØ¨ ÙØ³Ø§Ø¹Ø¯Ø©Ø Ø¥ÙØ®)",
  "response": "Ø§ÙØ±Ø¯ Ø§ÙÙÙØ§Ø³Ø¨ ÙÙÙØ³ØªØ®Ø¯Ù",
  "action": "Ø¥Ø¬Ø±Ø§Ø¡ ÙØ¬Ø¨ Ø¹ÙÙ Ø§ÙØ¨ÙØª Ø§ØªØ®Ø§Ø°Ù (ÙØ«Ù: none, notify_admin, add_to_blacklist, Ø¥ÙØ®)",
  "confidence": "ÙØ³ØªÙÙ Ø§ÙØ«ÙØ© (ÙÙ 0 Ø¥ÙÙ 1)"
}
`;

        const aiResponse = await askGemini(`Ø­ÙÙ ÙÙØ© Ø§ÙÙØ³ØªØ®Ø¯Ù ÙÙ ÙØ°Ù Ø§ÙØ±Ø³Ø§ÙØ© ÙØ±Ø¯ Ø¨Ø´ÙÙ ÙÙØ§Ø³Ø¨.`, context);
        
        try {
            return JSON.parse(aiResponse);
        } catch (parseError) {
            console.error('[â] Error parsing AI response:', parseError);
            return {
                intent: "unknown",
                response: "Ø¹Ø°Ø±Ø§ÙØ ÙÙ Ø£ÙÙÙ Ø±Ø³Ø§ÙØªÙ. ÙÙ ÙÙÙÙÙ ØªÙØ¶ÙØ­ ÙØ§ ØªØ­ØªØ§Ø¬ÙØ",
                action: "none",
                confidence: 0.2
            };
        }
    } catch (error) {
        console.error('[â] Error analyzing user intent:', error);
        return {
            intent: "unknown",
            response: "Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ ÙØ¹Ø§ÙØ¬Ø© Ø±Ø³Ø§ÙØªÙ. ÙØ±Ø¬Ù Ø§ÙÙØ­Ø§ÙÙØ© ÙØ±Ø© Ø£Ø®Ø±Ù ÙØ§Ø­ÙØ§Ù.",
            action: "none",
            confidence: 0.1
        };
    }
}

// Ø¯Ø§ÙØ© ÙØ¥ÙØ´Ø§Ø¡ Ø±Ø³Ø§Ø¦Ù ØªØ±Ø­ÙØ¨ ÙØ®ØµØµØ© Ø¨Ø§Ø³ØªØ®Ø¯Ø§Ù Ø§ÙØ°ÙØ§Ø¡ Ø§ÙØ§ØµØ·ÙØ§Ø¹Ù
async function generateWelcomeMessage(userName, groupName) {
    try {
        const context = `
Ø£ÙØª ÙØ³Ø§Ø¹Ø¯ Ø°ÙØ§Ø¡ Ø§ØµØ·ÙØ§Ø¹Ù ÙØ¨ÙØª WhatsApp. ÙÙÙØªÙ ÙÙ Ø¥ÙØ´Ø§Ø¡ Ø±Ø³Ø§ÙØ© ØªØ±Ø­ÙØ¨ Ø¯Ø§ÙØ¦Ø© ÙÙØ¯ÙØ© ÙØ¹Ø¶Ù Ø¬Ø¯ÙØ¯ ÙÙ Ø§ÙÙØ¬ÙÙØ¹Ø©.

Ø§ÙÙØ¹ÙÙÙØ§Øª Ø§ÙÙØªØ§Ø­Ø©:
- Ø§Ø³Ù Ø§ÙØ¹Ø¶Ù Ø§ÙØ¬Ø¯ÙØ¯: ${userName}
- Ø§Ø³Ù Ø§ÙÙØ¬ÙÙØ¹Ø©: ${groupName}

Ø§ÙØ±Ø¯ ÙØ¬Ø¨ Ø£Ù ÙÙÙÙ Ø±Ø³Ø§ÙØ© ØªØ±Ø­ÙØ¨ ÙØµÙØ±Ø© ÙØ¯Ø§ÙØ¦Ø©Ø ÙØ§ ØªØ²ÙØ¯ Ø¹Ù 3 Ø£Ø³Ø·Ø±.
`;

        const aiResponse = await askGemini(`Ø£ÙØ´Ø¦ Ø±Ø³Ø§ÙØ© ØªØ±Ø­ÙØ¨ ÙÙØ¹Ø¶Ù Ø§ÙØ¬Ø¯ÙØ¯.`, context);
        return aiResponse;
    } catch (error) {
        console.error('[â] Error generating welcome message:', error);
        return `ÙØ±Ø­Ø¨Ø§Ù ${userName} ÙÙ ÙØ¬ÙÙØ¹Ø© ${groupName}! ð`;
    }
}

// Ø¯Ø§ÙØ© ÙÙØªØ­ÙÙ ÙÙ ÙØ¬ÙØ¯ Ø§ÙØ®Ø·ÙØ·
function checkFonts() {
    const fontsDir = path.join(__dirname, 'fonts');
    const regularFont = path.join(fontsDir, 'Amiri-Regular.ttf');
    const boldFont = path.join(fontsDir, 'Amiri-Bold.ttf');
    
    if (!fs.existsSync(fontsDir)) {
        console.log('[â] Fonts directory not found. Creating...');
        fs.mkdirSync(fontsDir);
        return false;
    }
    
    if (!fs.existsSync(regularFont)) {
        console.log('[â] Amiri-Regular.ttf not found in fonts directory');
        return false;
    }
    
    if (!fs.existsSync(boldFont)) {
        console.log('[â] Amiri-Bold.ttf not found in fonts directory');
        return false;
    }
    
    console.log('[â] All fonts are available');
    return true;
}

// Ø¯Ø§ÙØ© ÙØ¥ÙØ´Ø§Ø¡ Ø¬Ø¯ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª ÙÙÙÙ PDF Ø¨Ø§Ø³ØªØ®Ø¯Ø§Ù pdfmake
async function generateLecturesTablePDF(lecturesData) {
    return new Promise((resolve, reject) => {
        try {
            console.log('[ð] Starting PDF generation...');
            console.log(`[ð] Number of lectures: ${lecturesData.length}`);
            
            // Ø§ÙØªØ­ÙÙ ÙÙ ÙØ¬ÙØ¯ Ø§ÙØ®Ø·ÙØ·
            if (!checkFonts()) {
                reject(new Error('Ø§ÙØ®Ø·ÙØ· Ø§ÙÙØ·ÙÙØ¨Ø© ØºÙØ± ÙÙØ¬ÙØ¯Ø©. ÙØ±Ø¬Ù Ø§ÙØªØ£ÙØ¯ ÙÙ ÙØ¬ÙØ¯ ÙÙÙØ§Øª Amiri-Regular.ttf Ù Amiri-Bold.ttf ÙÙ ÙØ¬ÙØ¯ fonts'));
                return;
            }

            // ØªØ¹Ø±ÙÙ Ø§ÙØ®Ø·ÙØ·
            const fonts = {
                Amiri: {
                    normal: path.join(__dirname, 'fonts/Amiri-Regular.ttf'),
                    bold: path.join(__dirname, 'fonts/Amiri-Bold.ttf'),
                }
            };

            console.log('[ð] Creating PDF printer...');
            const printer = new PdfPrinter(fonts);

            // Ø¥Ø¹Ø¯Ø§Ø¯ Ø§ÙØ¬Ø¯ÙÙ
            console.log('[ð] Preparing table data...');
            const body = [
                [
                    { text: 'Ø§ÙØªØ³ÙØ³Ù', bold: true },
                    { text: 'Ø§ÙØ´Ø¹Ø¨Ø©', bold: true },
                    { text: 'Ø§ÙÙØµÙ', bold: true },
                    { text: 'Ø§ÙÙØ§Ø¯Ø©', bold: true },
                    { text: 'Ø±ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø©', bold: true },
                    { text: 'Ø§ÙØ£Ø³ØªØ§Ø°', bold: true },
                    { text: 'Ø§ÙÙÙØ¬', bold: true },
                    { text: 'Ø§ÙØªØ§Ø±ÙØ®', bold: true }
                ]
            ];

            lecturesData.forEach((lecture, index) => {
                const date = lecture.date
                    ? new Date(lecture.date).toLocaleDateString('ar-EG')
                    : 'ØºÙØ± ÙØ­Ø¯Ø¯';

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

            console.log('[ð] Creating document definition...');
            const docDefinition = {
                defaultStyle: {
                    font: 'Amiri',
                    alignment: 'right', // ÙØ­Ø§Ø°Ø§Ø© Ø¹Ø±Ø¨ÙØ©
                    fontSize: 10
                },
                content: [
                    { text: 'Ø¬Ø¯ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª', style: 'header' },
                    { text: `ØªØ§Ø±ÙØ® Ø§ÙØ¥ÙØ´Ø§Ø¡: ${new Date().toLocaleDateString('ar-EG')}`, alignment: 'left' },
                    {
                        table: {
                            headerRows: 1,
                            widths: ['auto', 'auto', 'auto', '*', 'auto', '*', 'auto', 'auto'],
                            body
                        },
                        layout: 'lightHorizontalLines'
                    },
                    { text: `Ø¥Ø¬ÙØ§ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª: ${lecturesData.length}`, margin: [0, 10, 0, 0] },
                    { text: 'ØªÙ Ø¥ÙØ´Ø§Ø¡ ÙØ°Ø§ Ø§ÙØ¬Ø¯ÙÙ Ø¨Ø§Ø³ØªØ®Ø¯Ø§Ù Ø§ÙØ°ÙØ§Ø¡ Ø§ÙØ§ØµØ·ÙØ§Ø¹Ù', alignment: 'center', fontSize: 10, color: 'gray' }
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

            console.log('[ð] Creating PDF document...');
            const pdfDoc = printer.createPdfKitDocument(docDefinition);

            const chunks = [];
            pdfDoc.on('data', chunk => {
                chunks.push(chunk);
                console.log(`[ð] Received chunk: ${chunk.length} bytes`);
            });
            
            pdfDoc.on('end', () => {
                console.log('[ð] PDF generation completed');
                const buffer = Buffer.concat(chunks);
                console.log(`[ð] Final PDF size: ${buffer.length} bytes`);
                resolve(buffer);
            });
            
            pdfDoc.on('error', (error) => {
                console.error('[â] PDF generation error:', error);
                reject(error);
            });
            
            pdfDoc.end();

        } catch (error) {
            console.error('[â] Error in generateLecturesTablePDF:', error);
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
                console.log(`[ð¢] Sent to group: ${group.id._serialized}`);
            }
        }
    } catch (error) {
        console.error('[â] Error notifying groups:', error);
    }
}

async function notifyAdmins(groupId, text) {
    if (!isBotReady) return;
    
    try {
        const chat = await client.getChatById(groupId);
        const admins = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
        for (const admin of admins) {
            await client.sendMessage(admin.id._serialized, `ð¢ *Admin Notification*\n${text}${signature}`);
        }
    } catch (error) {
        console.error('[â] Error notifying admins:', error);
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
        console.error('[â] Error checking admin status:', error);
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
        console.error('[â] Error checking bot admin status:', error);
        return false;
    }
}

async function verifyGroup(groupId, groupName) {
    if (!isBotReady) return false;
    
    try {
        await client.getChatById(groupId);
        return true;
    } catch (error) {
        console.error(`[â] Error: Group ${groupName} not found:`, error);
        return false;
    }
}

function formatPhoneNumber(number) {
    number = number.replace(/\D/g, '');
    if (!number.startsWith('+')) number = '+' + number;
    return number;
}

// ÙØ¸Ø§Ù Ø§ÙÙØ³Ø® Ø§ÙØ§Ø­ØªÙØ§Ø·Ù Ø§ÙØªÙÙØ§Ø¦Ù
cron.schedule('0 0 * * *', async () => {
    try {
        console.log('[ð] Starting daily backup...');
        
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
            timestamp: new Date().toISOString()
        };
        
        const backupJson = JSON.stringify(backupData, null, 2);
        const backupMedia = new MessageMedia(
            'application/json',
            Buffer.from(backupJson).toString('base64'),
            `backup_${new Date().toISOString().split('T')[0]}.json`
        );
        
        await client.sendMessage(OWNER_ID, backupMedia, {
            caption: `ð *Ø§ÙÙØ³Ø®Ø© Ø§ÙØ§Ø­ØªÙØ§Ø·ÙØ© Ø§ÙÙÙÙÙØ©*\n\nð Ø§ÙØªØ§Ø±ÙØ®: ${new Date().toLocaleDateString('ar-EG')}\nð Ø¹Ø¯Ø¯ Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª: ${lecturesMetadata.length}\nð Ø¹Ø¯Ø¯ Ø§ÙÙØ³ØªØ®Ø¯ÙÙÙ: ${joinStats.size}\nð Ø¹Ø¯Ø¯ Ø§ÙÙØ­Ø¸ÙØ±ÙÙ: ${blacklist.size}${signature}`
        });
        
        console.log('[â] Daily backup completed and sent to owner');
    } catch (error) {
        console.error('[â] Error in daily backup:', error);
    }
});


// دوال إدارة الأرشيف
function loadArchive() {
    try {
        if (fs.existsSync(archiveFile)) {
            const data = fs.readFileSync(archiveFile, 'utf8');
            const archiveData = data ? JSON.parse(data) : {};
            archiveMessages.clear();
            for (const [key, value] of Object.entries(archiveData)) {
                archiveMessages.set(key, value);
            }
            console.log(`[📂] Loaded ${archiveMessages.size} archived messages`);
        }
    } catch (error) {
        console.error('[❌] Error loading archive:', error);
    }
}

function saveArchive() {
    try {
        const archiveData = Object.fromEntries(archiveMessages);
        fs.writeFileSync(archiveFile, JSON.stringify(archiveData, null, 2));
        console.log('[💾] Saved archive');
    } catch (error) {
        console.error('[❌] Error saving archive:', error);
    }
}

// دالة البحث المحسن في الأرشيف
function searchInArchive(searchTerm, sectionId = null, classId = null, subject = null) {
    const results = [];

    for (const [messageId, messageData] of archiveMessages) {
        let matches = true;

        // فلترة حسب المعايير المحددة
        if (sectionId && messageData.sectionId !== sectionId) matches = false;
        if (classId && messageData.classId !== classId) matches = false;
        if (subject && messageData.subject !== subject) matches = false;

        if (matches) {
            // البحث في النص أو اسم الملف
            const searchInText = 
                messageData.fileName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                messageData.subject?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                messageData.professor?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                messageData.lectureNumber?.toString().includes(searchTerm) ||
                messageData.pdfType?.toLowerCase().includes(searchTerm.toLowerCase());

            if (searchInText) {
                results.push(messageData);
            }
        }
    }

    // ترتيب النتائج حسب التاريخ (الأحدث أولاً)
    return results.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

// دالة إضافة رسالة للأرشيف التلقائي
async function addToArchive(lectureData, originalMessageId) {
    try {
        const archiveCaption = `📚 *تم إضافة ${lectureData.pdfType} جديد للأرشيف*

📖 الشعبة: ${lectureData.sectionName}
🏫 الفصل: ${lectureData.className}  
📚 المادة: ${lectureData.subject}
📋 رقم المحاضرة: ${lectureData.lectureNumber || 'غير محدد'}
👨‍🏫 الأستاذ: ${lectureData.professor}
👥 الفوج: ${lectureData.groupNumber}
📅 التاريخ: ${new Date().toLocaleDateString('ar-EG')}
👤 رفع بواسطة: ${lectureData.uploaderName}

🔍 للبحث استخدم: !بحث [كلمة البحث]
📥 لطلب الملف: !طلب [رقم النتيجة]`;

        // إرسال للمجموعة الأرشيفية
        if (await verifyGroup(PDF_ARCHIVE_GROUP, 'PDF Archive')) {
            const media = new MessageMedia(
                'application/pdf',
                lectureData.mediaData,
                lectureData.fileName
            );

            const archiveMsg = await client.sendMessage(PDF_ARCHIVE_GROUP, media, {
                caption: archiveCaption
            });

            // حفظ بيانات الرسالة في الأرشيف المحلي
            const archiveRecord = {
                messageId: archiveMsg.id._serialized,
                originalMessageId: originalMessageId,
                sectionId: lectureData.sectionId,
                classId: lectureData.classId,
                sectionName: lectureData.sectionName,
                className: lectureData.className,
                subject: lectureData.subject,
                lectureNumber: lectureData.lectureNumber,
                professor: lectureData.professor,
                groupNumber: lectureData.groupNumber,
                fileName: lectureData.fileName,
                pdfType: lectureData.pdfType,
                timestamp: Date.now(),
                uploaderName: lectureData.uploaderName,
                uploaderId: lectureData.uploaderId,
                searchKeywords: `${lectureData.subject} ${lectureData.professor} ${lectureData.lectureNumber} ${lectureData.pdfType}`.toLowerCase()
            };

            archiveMessages.set(archiveMsg.id._serialized, archiveRecord);
            saveArchive();

            console.log(`[📂] Added to archive: ${lectureData.fileName}`);
            return archiveMsg.id._serialized;
        }
    } catch (error) {
        console.error('[❌] Error adding to archive:', error);
        return null;
    }
}

// دالة البحث عن محاضرة في الأرشيف وإرسالها
async function findAndSendFromArchive(searchCriteria, userId, userName) {
    try {
        const results = searchInArchive(
            searchCriteria.searchTerm || '',
            searchCriteria.sectionId,
            searchCriteria.classId,
            searchCriteria.subject
        );

        if (results.length === 0) {
            return {
                success: false,
                message: `😔 لم يتم العثور على أي نتائج مطابقة للمعايير المحددة.`
            };
        }

        if (results.length === 1) {
            // إرسال الملف مباشرة إذا كان هناك نتيجة واحدة فقط
            const result = results[0];
            const archiveChat = await client.getChatById(PDF_ARCHIVE_GROUP);
            const archiveMessage = await archiveChat.fetchMessages({ 
                fromMe: false,
                limit: 100 
            });

            // البحث عن الرسالة في مجموعة الأرشيف
            const targetMessage = archiveMessage.find(msg => 
                msg.id._serialized === result.messageId
            );

            if (targetMessage && targetMessage.hasMedia) {
                const media = await targetMessage.downloadMedia();

                const caption = `📚 *${result.pdfType}*

📖 الشعبة: ${result.sectionName}
🏫 الفصل: ${result.className}
📚 المادة: ${result.subject}
📋 رقم المحاضرة: ${result.lectureNumber || 'غير محدد'}
👨‍🏫 الأستاذ: ${result.professor}
👥 الفوج: ${result.groupNumber}

✅ *تم إرسال الملف من الأرشيف التلقائي!*${signature}`;

                await client.sendMessage(userId, media, { caption });

                // تحديث إحصائيات التحميل
                lectureStats.set(userId, (lectureStats.get(userId) || 0) + 1);
                saveStats();

                return {
                    success: true,
                    message: `✅ تم إرسال "${result.fileName}" في الخاص!`
                };
            }
        }

        // إذا كان هناك أكثر من نتيجة، إرجاع قائمة للاختيار
        return {
            success: false,
            results: results,
            message: `🔍 تم العثور على ${results.length} نتيجة:`
        };

    } catch (error) {
        console.error('[❌] Error finding and sending from archive:', error);
        return {
            success: false,
            message: `❌ حدث خطأ أثناء البحث في الأرشيف.`
        };
    }
}


// Client events with enhanced debugging
client.on('qr', qr => {
    console.log('[ð¸] Scan QR code:');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('[â] Authenticated successfully!');
});

client.on('auth_failure', msg => {
    console.error('[â] Authentication failure:', msg);
    isBotReady = false;
});

client.on('ready', async () => {
    console.log('[â] Client ready!');
    isBotReady = true;
    
    try {
        const chats = await client.getChats();
        for (const chat of chats) {
            if (chat.isGroup) {
                groupsMetadata.set(chat.id._serialized, chat.name);
            }
        }
        console.log(`[â¹ï¸] Loaded ${groupsMetadata.size} groups`);
        
        // Send test message to owner with delay
        setTimeout(async () => {
            try {
                if (isBotReady) {
                    await client.sendMessage(OWNER_ID, 'â Ø§ÙØ¨ÙØª ÙØ¹ÙÙ Ø§ÙØ¢Ù!' + signature);
                    console.log('[ð¤] Test message sent to owner');
                }
            } catch (error) {
                console.error('[â] Error sending test message:', error);
            }
        }, 5000); // Wait 5 seconds before sending
    } catch (error) {
        console.error('[â] Error in ready event:', error);
    }
});

client.on('disconnected', reason => {
    console.log('[â] Client disconnected:', reason);
    isBotReady = false;
});

client.on('group_join', async (notification) => {
    if (!isBotReady) return;
    
    const groupId = notification.chatId;
    const userId = notification.id.participant;
    console.log(`[ð¢] User ${userId} joined ${groupId}`);
    
    if (blacklist.has(userId)) {
        if (await isBotAdmin(groupId)) {
            await client.removeParticipant(groupId, userId);
            console.log(`[ð] Removed blacklisted user ${userId}`);
        }
        return;
    }
    
    joinStats.set(groupId, joinStats.get(groupId) || []);
    joinStats.get(groupId).push({ userId, timestamp: Date.now() });
    saveStats();
    
    // Generate AI welcome message
    try {
        const contact = await client.getContactById(userId);
        const userName = contact.pushname || contact.name || "Ø¹Ø¶Ù Ø¬Ø¯ÙØ¯";
        const groupName = groupsMetadata.get(groupId) || "Ø§ÙÙØ¬ÙÙØ¹Ø©";
        
        const welcomeMessage = await generateWelcomeMessage(userName, groupName);
        await client.sendMessage(groupId, welcomeMessage);
    } catch (error) {
        console.error('[â] Error sending AI welcome message:', error);
    }
});

client.on('group_leave', async (notification) => {
    if (!isBotReady) return;
    
    const groupId = notification.chatId;
    const userId = notification.id.participant;
    console.log(`[ð¢] User ${userId} left ${groupId}`);
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
            await client.sendMessage(OWNER_ID, `â ï¸ You were removed from ${groupId}!\nâ Re-added you.${signature}`);
        }
    }
});

// Message handler with detailed debugging
client.on('message_create', async message => {
    try {
        if (!isBotReady) {
            console.log('[â ï¸] Bot not ready, ignoring message');
            return;
        }
        
        console.log('=== NEW MESSAGE ===');
        console.log('From:', message.from);
        console.log('Body:', message.body);
        console.log('Author:', message.author);
        console.log('Is Group:', message.from.includes('@g.us'));
        
        if (!message || !message.from) {
            console.log('[â ï¸] Invalid message, ignoring.');
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
        const groupName = isGroupMessage ? (groupsMetadata.get(currentGroupId) || "Ø§ÙÙØ¬ÙÙØ¹Ø©") : "";

        console.log(`[ð©] Message from ${senderName} (${userId}): ${content || '[non-text]'}`);

        // Ø¥Ø¶Ø§ÙØ© ØªØ£Ø®ÙØ± Ø·ÙÙÙ ÙÙ Ø§ÙØ±Ø¯ÙØ¯
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

        // AI command - ask AI
        if (content.startsWith('!ask ')) {
            const question = content.substring(5).trim();
            if (!question) {
                await client.sendMessage(replyTo, `â ï¸ ÙØ±Ø¬Ù ÙØªØ§Ø¨Ø© Ø³Ø¤Ø§Ù Ø¨Ø¹Ø¯ Ø§ÙØ£ÙØ± !ask${signature}`);
                return;
            }
            
            await message.react('ð¤');
            await client.sendMessage(replyTo, `ð¤ *Ø¬Ø§Ø±Ù ÙØ¹Ø§ÙØ¬Ø© Ø³Ø¤Ø§ÙÙ...*`);
            
            try {
                const aiResponse = await askGemini(question);
                await client.sendMessage(replyTo, `${aiResponse}${signature}`);
            } catch (error) {
                console.error('[â] Error in AI command:', error);
                await client.sendMessage(replyTo, `â ï¸ Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ ÙØ¹Ø§ÙØ¬Ø© Ø³Ø¤Ø§ÙÙ. ÙØ±Ø¬Ù Ø§ÙÙØ­Ø§ÙÙØ© ÙØ±Ø© Ø£Ø®Ø±Ù ÙØ§Ø­ÙØ§Ù.${signature}`);
            }
            return;
        }

        // AI command - analyze intent
        if (content === '!analyze' || content === '!ØªØ­ÙÙÙ') {
            if (!isGroupMessage) {
                await client.sendMessage(replyTo, `â ï¸ ÙØ°Ø§ Ø§ÙØ£ÙØ± ÙØ¹ÙÙ ÙÙ Ø§ÙÙØ¬ÙÙØ¹Ø§Øª ÙÙØ·!${signature}`);
                return;
            }
            
            await message.react('ð');
            await client.sendMessage(replyTo, `ð *Ø¬Ø§Ø±Ù ØªØ­ÙÙÙ Ø§ÙØ±Ø³Ø§Ø¦Ù Ø§ÙØ£Ø®ÙØ±Ø©...*`);
            
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
                                await notifyAdmins(currentGroupId, `ð *ØªØ­ÙÙÙ Ø°ÙØ§Ø¡ Ø§ØµØ·ÙØ§Ø¹Ù*\n\n${msgSenderName}: ${msg.body}\n\nØ§ÙÙÙØ©: ${analysis.intent}\nØ§ÙØ±Ø¯ Ø§ÙÙÙØªØ±Ø­: ${analysis.response}`);
                            }
                        }
                    }
                }
                
                await client.sendMessage(replyTo, `â *Ø§ÙØªÙÙ ØªØ­ÙÙÙ Ø§ÙØ±Ø³Ø§Ø¦Ù!*${signature}`);
            } catch (error) {
                console.error('[â] Error in analyze command:', error);
                await client.sendMessage(replyTo, `â ï¸ Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ ØªØ­ÙÙÙ Ø§ÙØ±Ø³Ø§Ø¦Ù. ÙØ±Ø¬Ù Ø§ÙÙØ­Ø§ÙÙØ© ÙØ±Ø© Ø£Ø®Ø±Ù ÙØ§Ø­ÙØ§Ù.${signature}`);
            }
            return;
        }

        // AI command - generate content
        if (content.startsWith('!generate ')) {
            const prompt = content.substring(9).trim();
            if (!prompt) {
                await client.sendMessage(replyTo, `â ï¸ ÙØ±Ø¬Ù ÙØªØ§Ø¨Ø© ÙØµÙ ÙÙÙØ­ØªÙÙ Ø¨Ø¹Ø¯ Ø§ÙØ£ÙØ± !generate${signature}`);
                return;
            }
            
            await message.react('âï¸');
            await client.sendMessage(replyTo, `âï¸ *Ø¬Ø§Ø±Ù Ø¥ÙØ´Ø§Ø¡ Ø§ÙÙØ­ØªÙÙ...*`);
            
            try {
                const aiResponse = await askGemini(`Ø£ÙØ´Ø¦ ÙØ­ØªÙÙ Ø¨ÙØ§Ø¡Ù Ø¹ÙÙ Ø§ÙÙØµÙ Ø§ÙØªØ§ÙÙ: ${prompt}`);
                await client.sendMessage(replyTo, `${aiResponse}${signature}`);
            } catch (error) {
                console.error('[â] Error in generate command:', error);
                await client.sendMessage(replyTo, `â ï¸ Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ Ø¥ÙØ´Ø§Ø¡ Ø§ÙÙØ­ØªÙÙ. ÙØ±Ø¬Ù Ø§ÙÙØ­Ø§ÙÙØ© ÙØ±Ø© Ø£Ø®Ø±Ù ÙØ§Ø­ÙØ§Ù.${signature}`);
            }
            return;
        }

        // Command to generate lectures table PDF
        if (content === '!Ø¬Ø¯ÙÙ_Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª' || content === '!lectures_table') {
            await message.react('ð');
            await client.sendMessage(replyTo, `ð *Ø¬Ø§Ø±Ù Ø¥ÙØ´Ø§Ø¡ Ø¬Ø¯ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª Ø¨Ø§Ø³ØªØ®Ø¯Ø§Ù pdfmake...*`);
            
            try {
                console.log(`[ð] User requested lectures table. Current lectures count: ${lecturesMetadata.length}`);
                
                if (lecturesMetadata.length === 0) {
                    await client.sendMessage(replyTo, `â ï¸ ÙØ§ ØªÙØ¬Ø¯ ÙØ­Ø§Ø¶Ø±Ø§Øª ÙØ¶Ø§ÙØ© Ø¨Ø¹Ø¯!${signature}`);
                    await message.react('â');
                    return;
                }
                
                const pdfBuffer = await generateLecturesTablePDF(lecturesMetadata);
                
                // Create Media object from buffer
                const media = new MessageMedia(
                    'application/pdf',
                    pdfBuffer.toString('base64'),
                    `Ø¬Ø¯ÙÙ_Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª_${new Date().toISOString().split('T')[0]}.pdf`
                );
                
                await client.sendMessage(replyTo, media, {
                    caption: `ð *Ø¬Ø¯ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª*\n\nØªÙ Ø¥ÙØ´Ø§Ø¡ Ø§ÙØ¬Ø¯ÙÙ Ø¨Ø§Ø³ØªØ®Ø¯Ø§Ù pdfmake!\nð Ø§ÙØªØ§Ø±ÙØ®: ${new Date().toLocaleDateString('ar-EG')}\nð Ø¹Ø¯Ø¯ Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª: ${lecturesMetadata.length}\nð¤ ØªÙ Ø¥ÙØ´Ø§Ø¤Ù Ø¨ÙØ§Ø³Ø·Ø© Gemini AI${signature}`
                });
                
                await message.react('â');
                console.log('[â] Lectures table sent successfully');
            } catch (error) {
                console.error('[â] Error generating lectures table:', error);
                await client.sendMessage(replyTo, `â ï¸ Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ Ø¥ÙØ´Ø§Ø¡ Ø¬Ø¯ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª: ${error.message}${signature}`);
                await message.react('â');
            }
            
            return;
        }

        // Pin message command
        if (isGroupMessage && content === '!ØªØ«Ø¨ÙØª' && message.hasQuotedMsg) {
            if (await isAdmin(userId, currentGroupId)) {
                if (await isBotAdmin(currentGroupId)) {
                    const quotedMsg = await message.getQuotedMessage();
                    await quotedMsg.pin();
                    await client.sendMessage(OWNER_ID, `â Pinned message in ${currentGroupId}${signature}`);
                } else {
                    await client.sendMessage(OWNER_ID, `â ï¸ I'm not an admin in ${currentGroupId}!${signature}`);
                }
            }
            return;
        }

        // Add PDF command - ÙØªØ§Ø­ ÙØ¬ÙÙØ¹ Ø£Ø¹Ø¶Ø§Ø¡ Ø§ÙÙØ¬ÙÙØ¹Ø©
        if (content === '!Ø§Ø¶Ø§ÙØ©_pdf' || content === '!add pdf') {
            if (isGroupMessage) {
                // Ø§ÙØªØ­ÙÙ ÙÙ ÙØ¬ÙØ¯ Ø¨ÙØ§ÙØ§Øª
                if (sections.size === 0 || classes.size === 0 || groupsData.size === 0 || 
                    professors.size === 0 || subjects.size === 0) {
                    await message.react('â ï¸');
                    await client.sendMessage(replyTo, `â ï¸ ÙÙ ÙØªÙ Ø¥Ø¹Ø¯Ø§Ø¯ Ø¨ÙØ§ÙØ§Øª Ø§ÙØ´Ø¹Ø¨ Ø£Ù Ø§ÙÙØµÙÙ Ø£Ù Ø§ÙØ£ÙÙØ§Ø¬ Ø£Ù Ø§ÙØ£Ø³Ø§ØªØ°Ø© Ø£Ù Ø§ÙÙÙØ§Ø¯ Ø¨Ø¹Ø¯!${signature}`);
                    return;
                }
                
                await message.react('ð');
                await client.sendMessage(replyTo, `
ð *Ø¥Ø¶Ø§ÙØ© ÙÙÙ PDF*
ÙØ±Ø­Ø¨Ø§Ù ${senderName}! ðââï¸
ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± ÙÙØ¹ Ø§ÙÙÙÙ:
1. ÙØ­Ø§Ø¶Ø±Ø©
2. ÙÙØ®Øµ

ð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙØ®ÙØ§Ø± Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`);
                userState.set(userId, { 
                    step: 'select_pdf_type', 
                    timestamp: Date.now() 
                });
            } else {
                await message.react('â ï¸');
                await client.sendMessage(replyTo, `â ï¸ ÙØ°Ø§ Ø§ÙØ£ÙØ± ÙØ¹ÙÙ ÙÙ Ø§ÙÙØ¬ÙÙØ¹Ø§Øª ÙÙØ·!${signature}`);
            }
            return;
        }

// Download PDF command - ÙØªØ§Ø­ ÙØ¬ÙÙØ¹ Ø£Ø¹Ø¶Ø§Ø¡ Ø§ÙÙØ¬ÙÙØ¹Ø©
if (content === '!ØªØ­ÙÙÙ' || content === '!download') {
    if (isGroupMessage) {
        // Ø§ÙØªØ­ÙÙ ÙÙ ÙØ¬ÙØ¯ Ø¨ÙØ§ÙØ§Øª
        if (sections.size === 0 || classes.size === 0 || groupsData.size === 0 || 
            professors.size === 0 || subjects.size === 0) {
            await message.react('â ï¸');
            await client.sendMessage(replyTo, `â ï¸ ÙÙ ÙØªÙ Ø¥Ø¹Ø¯Ø§Ø¯ Ø¨ÙØ§ÙØ§Øª Ø§ÙØ´Ø¹Ø¨ Ø£Ù Ø§ÙÙØµÙÙ Ø£Ù Ø§ÙØ£ÙÙØ§Ø¬ Ø£Ù Ø§ÙØ£Ø³Ø§ØªØ°Ø© Ø£Ù Ø§ÙÙÙØ§Ø¯ Ø¨Ø¹Ø¯!${signature}`);
            return;
        }
        
        await message.react('ð¥');
        await client.sendMessage(replyTo, `
ð¥ *ØªØ­ÙÙÙ ÙÙÙ PDF*
ÙØ±Ø­Ø¨Ø§Ù ${senderName}! ðââï¸
ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± ÙÙØ¹ Ø§ÙÙÙÙ:
1. ÙØ­Ø§Ø¶Ø±Ø©
2. ÙÙØ®Øµ

ð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙØ®ÙØ§Ø± Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`);
        userState.set(userId, { 
            step: 'select_pdf_type_for_download', 
            timestamp: Date.now(),
            replyTo: replyTo // Ø­ÙØ¸ ÙÙØ§Ù Ø§ÙØ±Ø¯
        });
    } else {
        await message.react('â ï¸');
        await client.sendMessage(replyTo, `â ï¸ ÙØ°Ø§ Ø§ÙØ£ÙØ± ÙØ¹ÙÙ ÙÙ Ø§ÙÙØ¬ÙÙØ¹Ø§Øª ÙÙØ·!${signature}`);
    }
    return;
}

// Handle PDF download process
if (userState.has(userId)) {
    const state = userState.get(userId);
    const targetReplyTo = state.replyTo || replyTo; // Ø§Ø³ØªØ®Ø¯Ø§Ù ÙÙØ§Ù Ø§ÙØ±Ø¯ Ø§ÙÙØ­ÙÙØ¸

    // Cancel command
    if (content.toLowerCase() === 'Ø¥ÙØºØ§Ø¡') {
        await message.react('â');
        await client.sendMessage(targetReplyTo, `â ØªÙ Ø§ÙØ¥ÙØºØ§Ø¡!${signature}`);
        userState.delete(userId);
        return;
    }

    // Step: Select PDF type for download
    if (state.step === 'select_pdf_type_for_download') {
        const option = parseInt(content);
        if (isNaN(option) || (option !== 1 && option !== 2)) {
            await message.react('â ï¸');
            await client.sendMessage(targetReplyTo, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± 1 ÙÙÙØ­Ø§Ø¶Ø±Ø© Ø£Ù 2 ÙÙÙÙØ®Øµ.${signature}`);
            return;
        }
        
        const pdfType = option === 1 ? 'ÙØ­Ø§Ø¶Ø±Ø©' : 'ÙÙØ®Øµ';
        
        // Update state
        state.pdfType = pdfType;
        state.step = 'select_section_for_download';
        userState.set(userId, state);
        
        // Show sections
        let sectionsList = `ð *Ø§Ø®ØªØ± Ø§ÙØ´Ø¹Ø¨Ø©*\n\n`;
        let index = 1;
        for (const [id, name] of sections) {
            sectionsList += `${index}. ${name}\n`;
            index++;
        }
        sectionsList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙØ´Ø¹Ø¨Ø© Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;
        await client.sendMessage(targetReplyTo, sectionsList);
        return;
    }

    // Step: Select section for download
    if (state.step === 'select_section_for_download') {
        const option = parseInt(content);
        if (isNaN(option) || option < 1 || option > sections.size) {
            await message.react('â ï¸');
            await client.sendMessage(targetReplyTo, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙØ´Ø¹Ø¨Ø© Ø§ÙØµØ­ÙØ­.${signature}`);
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
        let classesList = `ð« *Ø§Ø®ØªØ± Ø§ÙÙØµÙ*\n\n`;
        let index = 1;
        for (const [id, name] of classes) {
            classesList += `${index}. ${name}\n`;
            index++;
        }
        classesList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙÙØµÙ Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;
        await client.sendMessage(targetReplyTo, classesList);
        return;
    }

    // Step: Select class for download
    if (state.step === 'select_class_for_download') {
        const option = parseInt(content);
        if (isNaN(option) || option < 1 || option > classes.size) {
            await message.react('â ï¸');
            await client.sendMessage(targetReplyTo, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙÙØµÙ Ø§ÙØµØ­ÙØ­.${signature}`);
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
        let groupsList = `ð¥ *Ø§Ø®ØªØ± Ø§ÙÙÙØ¬*\n\n`;
        let index = 1;
        for (const [id, name] of groupsData) {
            groupsList += `${index}. ${name}\n`;
            index++;
        }
        groupsList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙÙÙØ¬ Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;
        await client.sendMessage(targetReplyTo, groupsList);
        return;
    }

    // Step: Select group for download
    if (state.step === 'select_group_for_download') {
        const option = parseInt(content);
        if (isNaN(option) || option < 1 || option > groupsData.size) {
            await message.react('â ï¸');
            await client.sendMessage(targetReplyTo, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙÙÙØ¬ Ø§ÙØµØ­ÙØ­.${signature}`);
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
        let professorsList = `ð¨âð« *Ø§Ø®ØªØ± Ø§ÙØ£Ø³ØªØ§Ø°*\n\n`;
        let index = 1;
        for (const [id, name] of professors) {
            professorsList += `${index}. ${name}\n`;
            index++;
        }
        professorsList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙØ£Ø³ØªØ§Ø° Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;
        await client.sendMessage(targetReplyTo, professorsList);
        return;
    }

    // Step: Select professor for download
    if (state.step === 'select_professor_for_download') {
        const option = parseInt(content);
        if (isNaN(option) || option < 1 || option > professors.size) {
            await message.react('â ï¸');
            await client.sendMessage(targetReplyTo, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙØ£Ø³ØªØ§Ø° Ø§ÙØµØ­ÙØ­.${signature}`);
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
        let subjectsList = `ð *Ø§Ø®ØªØ± Ø§ÙÙØ§Ø¯Ø©*\n\n`;
        let index = 1;
        for (const [id, name] of subjects) {
            subjectsList += `${index}. ${name}\n`;
            index++;
        }
        subjectsList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙÙØ§Ø¯Ø© Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;
        await client.sendMessage(targetReplyTo, subjectsList);
        return;
    }

    // Step: Select subject for download
    if (state.step === 'select_subject_for_download') {
        const option = parseInt(content);
        if (isNaN(option) || option < 1 || option > subjects.size) {
            await message.react('â ï¸');
            await client.sendMessage(targetReplyTo, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙÙØ§Ø¯Ø© Ø§ÙØµØ­ÙØ­.${signature}`);
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
ð *Ø£Ø¯Ø®Ù Ø±ÙÙ ${state.pdfType}*
ÙØ±Ø¬Ù Ø¥Ø¯Ø®Ø§Ù Ø±ÙÙ ${state.pdfType}:
ð¡ Ø£Ø±Ø³Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`);
        return;
    }

    // Step: Enter lecture number for download
    if (state.step === 'enter_lecture_number_for_download') {
        const lectureNumber = content.trim();
        if (!lectureNumber) {
            await message.react('â ï¸');
            await client.sendMessage(targetReplyTo, `â ï¸ ÙØ±Ø¬Ù Ø¥Ø¯Ø®Ø§Ù Ø±ÙÙ ${state.pdfType}!${signature}`);
            return;

        // معالجات حالات عرض المحاضرات - NEW
        if (state.step === 'select_section_for_viewing') {
            const option = parseInt(content);
            if (isNaN(option) || option < 1 || option > sections.size) {
                await message.react('⚠️');
                await client.sendMessage(targetReplyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الشعبة الصحيح.${signature}`);
                return;
            }

            // الحصول على معرف واسم الشعبة
            const sectionId = Array.from(sections.keys())[option - 1];
            const sectionName = sections.get(sectionId);

            // تحديث الحالة
            state.sectionId = sectionId;
            state.sectionName = sectionName;
            state.step = 'select_class_for_viewing';
            userState.set(userId, state);

            // عرض الفصول
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

        if (state.step === 'select_class_for_viewing') {
            const option = parseInt(content);
            if (isNaN(option) || option < 1 || option > classes.size) {
                await message.react('⚠️');
                await client.sendMessage(targetReplyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الفصل الصحيح.${signature}`);
                return;
            }

            // الحصول على معرف واسم الفصل
            const classId = Array.from(classes.keys())[option - 1];
            const className = classes.get(classId);

            // تحديث الحالة
            state.classId = classId;
            state.className = className;
            userState.set(userId, state);

            await message.react('📚');
            await client.sendMessage(targetReplyTo, `📚 *جاري البحث عن المحاضرات...*`);

            // البحث عن المحاضرات للشعبة والفصل المحددين
            const availableLectures = lecturesMetadata.filter(lecture => 
                lecture.sectionId === state.sectionId && lecture.classId === state.classId
            );

            // البحث في الأرشيف أيضاً
            const archiveLectures = searchInArchive('', state.sectionId, state.classId);

            // دمج النتائج
            const allLectures = [...availableLectures];
            archiveLectures.forEach(archiveItem => {
                if (!availableLectures.some(local => local.fileName === archiveItem.fileName)) {
                    allLectures.push(archiveItem);
                }
            });

            if (allLectures.length > 0) {
                // تجميع المحاضرات حسب المادة
                const lecturesBySubject = {};
                allLectures.forEach(lecture => {
                    if (!lecturesBySubject[lecture.subject]) {
                        lecturesBySubject[lecture.subject] = [];
                    }
                    lecturesBySubject[lecture.subject].push(lecture);
                });

                let lecturesText = `📚 *المحاضرات المتوفرة*\n\n`;
                lecturesText += `📖 الشعبة: ${state.sectionName}\n`;
                lecturesText += `🏫 الفصل: ${state.className}\n\n`;

                let totalCount = 0;
                for (const [subject, subjectLectures] of Object.entries(lecturesBySubject)) {
                    lecturesText += `📚 **${subject}**\n`;

                    // تجميع حسب الأستاذ والفوج
                    const groupedLectures = {};
                    subjectLectures.forEach(lecture => {
                        const key = `${lecture.professor}_${lecture.groupNumber}`;
                        if (!groupedLectures[key]) {
                            groupedLectures[key] = [];
                        }
                        groupedLectures[key].push(lecture);
                    });

                    for (const [key, professorLectures] of Object.entries(groupedLectures)) {
                        const firstLecture = professorLectures[0];
                        lecturesText += `   👨‍🏫 الأستاذ: ${firstLecture.professor}\n`;
                        lecturesText += `   👥 الفوج: ${firstLecture.groupNumber}\n`;
                        lecturesText += `   📋 المحاضرات: `;

                        const lectureNumbers = professorLectures.map(l => l.lectureNumber || 'غ.م').sort();
                        lecturesText += lectureNumbers.join(', ') + `\n`;
                        lecturesText += `   📄 الأنواع: `;

                        const types = [...new Set(professorLectures.map(l => l.pdfType))];
                        lecturesText += types.join(', ') + `\n\n`;

                        totalCount += professorLectures.length;
                    }
                }

                lecturesText += `📊 **إجمالي المحاضرات: ${totalCount}**\n\n`;
                lecturesText += `🔍 **للبحث في محاضرة معينة:**\n`;
                lecturesText += `• !بحث [اسم المادة]\n`;
                lecturesText += `• !بحث [اسم الأستاذ]\n`;
                lecturesText += `• !بحث [رقم المحاضرة]\n\n`;
                lecturesText += `📥 **للطلب المباشر:**\n`;
                lecturesText += `!إرسال_مباشر ${Array.from(sections.keys()).indexOf(state.sectionId) + 1} ${Array.from(classes.keys()).indexOf(state.classId) + 1} [اسم المادة]${signature}`;

                await client.sendMessage(targetReplyTo, lecturesText);
            } else {
                await client.sendMessage(targetReplyTo, `😔 لا توجد محاضرات متوفرة للشعبة "${state.sectionName}" والفصل "${state.className}" حالياً.\n\n💡 تواصل مع المشرفين لإضافة محاضرات جديدة.${signature}`);
            }

            // مسح حالة المستخدم
            userState.delete(userId);
            return;
        }

        // معالجات حالات البحث المتقدم - NEW
        if (state.step === 'advanced_search_section') {
            const option = parseInt(content);
            if (isNaN(option) || option < 1 || option > sections.size) {
                await message.react('⚠️');
                await client.sendMessage(targetReplyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الشعبة الصحيح.${signature}`);
                return;
            }

            // الحصول على معرف واسم الشعبة
            const sectionId = Array.from(sections.keys())[option - 1];
            const sectionName = sections.get(sectionId);

            // تحديث الحالة
            state.sectionId = sectionId;
            state.sectionName = sectionName;
            state.step = 'advanced_search_class';
            userState.set(userId, state);

            // عرض الفصول
            let classesList = `🏫 *اختر الفصل للبحث المتقدم*\n\n`;
            let index = 1;
            for (const [id, name] of classes) {
                classesList += `${index}. ${name}\n`;
                index++;
            }
            classesList += `\n💡 أرسل رقم الفصل أو *إلغاء* للخروج${signature}`;
            await client.sendMessage(targetReplyTo, classesList);
            return;
        }

        if (state.step === 'advanced_search_class') {
            const option = parseInt(content);
            if (isNaN(option) || option < 1 || option > classes.size) {
                await message.react('⚠️');
                await client.sendMessage(targetReplyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم الفصل الصحيح.${signature}`);
                return;
            }

            // الحصول على معرف واسم الفصل
            const classId = Array.from(classes.keys())[option - 1];
            const className = classes.get(classId);

            // تحديث الحالة
            state.classId = classId;
            state.className = className;
            state.step = 'advanced_search_subject';
            userState.set(userId, state);

            // عرض المواد المتوفرة لهذه الشعبة والفصل
            const availableSubjects = new Set();
            lecturesMetadata.forEach(lecture => {
                if (lecture.sectionId === state.sectionId && lecture.classId === state.classId) {
                    availableSubjects.add(lecture.subject);
                }
            });

            // إضافة المواد من الأرشيف
            const archiveResults = searchInArchive('', state.sectionId, state.classId);
            archiveResults.forEach(item => availableSubjects.add(item.subject));

            if (availableSubjects.size > 0) {
                let subjectsList = `📚 *اختر المادة للبحث المتقدم*\n\n`;
                const subjects = Array.from(availableSubjects).sort();
                subjects.forEach((subject, index) => {
                    subjectsList += `${index + 1}. ${subject}\n`;
                });
                subjectsList += `\n💡 أرسل رقم المادة أو *إلغاء* للخروج${signature}`;
                await client.sendMessage(targetReplyTo, subjectsList);

                // حفظ قائمة المواد في الحالة
                state.availableSubjects = subjects;
                userState.set(userId, state);
            } else {
                await client.sendMessage(targetReplyTo, `😔 لا توجد مواد متوفرة للشعبة "${state.sectionName}" والفصل "${state.className}".${signature}`);
                userState.delete(userId);
            }
            return;
        }

        if (state.step === 'advanced_search_subject') {
            const option = parseInt(content);
            if (isNaN(option) || option < 1 || option > state.availableSubjects.length) {
                await message.react('⚠️');
                await client.sendMessage(targetReplyTo, `⚠️ خيار غير صحيح! يرجى اختيار رقم المادة الصحيح.${signature}`);
                return;
            }

            const selectedSubject = state.availableSubjects[option - 1];

            await message.react('🔍');
            await client.sendMessage(targetReplyTo, `🔍 *جاري البحث المتقدم في مادة "${selectedSubject}"...*`);

            // البحث المتقدم
            const advancedResults = searchInArchive('', state.sectionId, state.classId, selectedSubject);
            const localAdvancedResults = lecturesMetadata.filter(lecture => 
                lecture.sectionId === state.sectionId && 
                lecture.classId === state.classId && 
                lecture.subject === selectedSubject
            );

            // دمج النتائج
            const allAdvancedResults = [...localAdvancedResults];
            advancedResults.forEach(archiveItem => {
                if (!localAdvancedResults.some(local => local.fileName === archiveItem.fileName)) {
                    allAdvancedResults.push(archiveItem);
                }
            });

            if (allAdvancedResults.length > 0) {
                let resultsText = `🎯 *نتائج البحث المتقدم*\n\n`;
                resultsText += `📖 الشعبة: ${state.sectionName}\n`;
                resultsText += `🏫 الفصل: ${state.className}\n`;
                resultsText += `📚 المادة: ${selectedSubject}\n\n`;

                allAdvancedResults.forEach((lecture, index) => {
                    resultsText += `${index + 1}. 📋 المحاضرة رقم: ${lecture.lectureNumber || 'غير محدد'}\n`;
                    resultsText += `   👨‍🏫 الأستاذ: ${lecture.professor}\n`;
                    resultsText += `   👥 الفوج: ${lecture.groupNumber}\n`;
                    resultsText += `   📄 النوع: ${lecture.pdfType}\n`;
                    resultsText += `   📅 التاريخ: ${lecture.timestamp ? new Date(lecture.timestamp).toLocaleDateString('ar-EG') : 'غير محدد'}\n\n`;
                });

                resultsText += `📊 العدد الإجمالي: ${allAdvancedResults.length} ملف\n\n`;
                resultsText += `📥 لطلب ملف معين، أرسل: !طلب [رقم الملف]${signature}`;

                await client.sendMessage(targetReplyTo, resultsText);

                // حفظ النتائج لطلب الملفات
                state.step = 'search_results';
                state.searchResults = allAdvancedResults;
                userState.set(userId, state);
            } else {
                await client.sendMessage(targetReplyTo, `😔 لم يتم العثور على أي محاضرات للمعايير المحددة.${signature}`);
                userState.delete(userId);
            }
            return;
        }


        }
        
        // Update state
        state.lectureNumber = lectureNumber;
        state.step = 'search_lecture';
        userState.set(userId, state);
        
        // Search for the lecture
        const foundLectures = lecturesMetadata.filter(lecture => 
            lecture.type === state.pdfType &&
            lecture.subjectId === state.subjectId &&
            lecture.professorId === state.professorId &&
            lecture.groupId === state.groupId &&
            lecture.classId === state.classId &&
            lecture.sectionId === state.sectionId &&
            lecture.lectureNumber === state.lectureNumber
        );
        
        if (foundLectures.length === 0) {
            await message.react('â');
            await client.sendMessage(targetReplyTo, `â ï¸ ÙÙ ÙØªÙ Ø§ÙØ¹Ø«ÙØ± Ø¹ÙÙ ${state.pdfType} Ø¨ÙØ°Ù Ø§ÙÙÙØ§ØµÙØ§Øª!${signature}`);
            userState.delete(userId);
            return;
        }
        
        // Send the lecture
        const lecture = foundLectures[0];
        
        // Create a message with lecture details
        const lectureInfo = `
ð *${state.pdfType} ØªÙ Ø§ÙØ¹Ø«ÙØ± Ø¹ÙÙÙ*

ð *Ø§ÙÙØ§Ø¯Ø©:* ${state.subjectName}
ð *Ø±ÙÙ ${state.pdfType}:* ${state.lectureNumber}
ð¨âð« *Ø§ÙØ£Ø³ØªØ§Ø°:* ${state.professorName}
ð¥ *Ø§ÙÙÙØ¬:* ${state.groupName}
ð« *Ø§ÙÙØµÙ:* ${state.className}
ð *Ø§ÙØ´Ø¹Ø¨Ø©:* ${state.sectionName}
ð *ØªØ§Ø±ÙØ® Ø§ÙØ¥Ø¶Ø§ÙØ©:* ${new Date(lecture.date).toLocaleDateString('ar-EG')}

ð¡ *ÙÙØ§Ø­Ø¸Ø©:* Ø³ÙØªÙ Ø¥Ø±Ø³Ø§Ù Ø§ÙÙÙÙ Ø§ÙÙØ¹ÙÙ ÙÙ ÙØ¬ÙÙØ¹Ø© Ø§ÙØ£Ø±Ø´ÙÙ
${signature}`;

        await client.sendMessage(targetReplyTo, lectureInfo);
        
        // Here you would normally send the actual PDF file
        // For now, we'll just send a notification to the archive group
        await client.sendMessage(PDF_ARCHIVE_GROUP, `
ð¥ *Ø·ÙØ¨ ØªØ­ÙÙÙ ${state.pdfType}*

ð¤ *Ø§ÙØ·Ø§ÙØ¨:* ${senderName}
ð *Ø§ÙÙØ§Ø¯Ø©:* ${state.subjectName}
ð *Ø±ÙÙ ${state.pdfType}:* ${state.lectureNumber}
ð¨âð« *Ø§ÙØ£Ø³ØªØ§Ø°:* ${state.professorName}
ð¥ *Ø§ÙÙÙØ¬:* ${state.groupName}
ð« *Ø§ÙÙØµÙ:* ${state.className}
ð *Ø§ÙØ´Ø¹Ø¨Ø©:* ${state.sectionName}

ÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§ÙÙÙÙ Ø§ÙÙØ·ÙÙØ¨${signature}`);
        
        userState.delete(userId);
        return;
    }
}
        // Show commands
        if (content === '!commands' || content === '!Ø£ÙØ§ÙØ±') {
            await message.react('ð');
            await client.sendMessage(replyTo, `
ð *ÙØ§Ø¦ÙØ© Ø§ÙØ£ÙØ§ÙØ± Ø§ÙÙØªØ§Ø­Ø©:*

1. !ask [Ø³Ø¤Ø§Ù] - Ø·Ø±Ø­ Ø³Ø¤Ø§Ù Ø¹ÙÙ Ø§ÙØ°ÙØ§Ø¡ Ø§ÙØ§ØµØ·ÙØ§Ø¹Ù
2. !analyze - ØªØ­ÙÙÙ Ø§ÙØ±Ø³Ø§Ø¦Ù ÙÙ Ø§ÙÙØ¬ÙÙØ¹Ø©
3. !generate [ÙØµÙ] - Ø¥ÙØ´Ø§Ø¡ ÙØ­ØªÙÙ Ø¨Ø§Ø³ØªØ®Ø¯Ø§Ù Ø§ÙØ°ÙØ§Ø¡ Ø§ÙØ§ØµØ·ÙØ§Ø¹Ù
4. !Ø¬Ø¯ÙÙ_Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª - Ø¥ÙØ´Ø§Ø¡ Ø¬Ø¯ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª ÙÙÙÙ PDF
5. !ØªØ«Ø¨ÙØª - ØªØ«Ø¨ÙØª Ø±Ø³Ø§ÙØ© (ÙÙÙØ´Ø±ÙÙÙ)
6. !Ø§Ø¶Ø§ÙØ©_pdf - Ø¥Ø¶Ø§ÙØ© ÙÙÙ PDF Ø¬Ø¯ÙØ¯
7. !ØªØ­ÙÙÙ - ØªØ­ÙÙÙ ÙÙÙ PDF
8. !Ø¥Ø¯Ø§Ø±Ø© - ÙÙØ­Ø© Ø§ÙØªØ­ÙÙ (ÙÙÙØ§ÙÙ)
9. !commands - Ø¹Ø±Ø¶ ÙØ°Ù Ø§ÙÙØ§Ø¦ÙØ©

ð¡ Ø¥Ø±Ø³Ø§Ù *Ø¥ÙØºØ§Ø¡* ÙÙ Ø£Ù ÙÙØª ÙØ¥ÙØºØ§Ø¡ Ø§ÙØ¹ÙÙÙØ©${signature}`);
            return;
        }

        // أمر عرض المحاضرات - NEW
        if (content === '!عرض_المحاضرات' || content === '!show_lectures') {
            if (isGroupMessage) {
                // التحقق من وجود البيانات
                if (sections.size === 0 || classes.size === 0) {
                    await message.react('⚠️');
                    await client.sendMessage(replyTo, `⚠️ لم يتم إعداد بيانات الشعب أو الفصول بعد!${signature}`);
                    return;
                }

                await message.react('📚');
                await client.sendMessage(replyTo, `
📚 *عرض المحاضرات المتوفرة*
مرحباً ${senderName}! 🙋‍♂️

يرجى اختيار الشعبة:${signature}`);

                // عرض قائمة الشعب
                let sectionsList = `📚 *اختر الشعبة*\n\n`;
                let index = 1;
                for (const [id, name] of sections) {
                    sectionsList += `${index}. ${name}\n`;
                    index++;
                }
                sectionsList += `\n💡 أرسل رقم الشعبة أو *إلغاء* للخروج${signature}`;
                await client.sendMessage(replyTo, sectionsList);

                userState.set(userId, { 
                    step: 'select_section_for_viewing', 
                    timestamp: Date.now(),
                    replyTo: replyTo
                });
            } else {
                await message.react('⚠️');
                await client.sendMessage(replyTo, `⚠️ هذا الأمر يعمل في المجموعات فقط!${signature}`);
            }
            return;
        }

        // أمر البحث في الأرشيف - NEW  
        if (content.startsWith('!بحث ') || content.startsWith('!search ')) {
            const searchTerm = content.substring(content.startsWith('!بحث ') ? 5 : 8).trim();
            if (!searchTerm) {
                await message.react('⚠️');
                await client.sendMessage(replyTo, `⚠️ يرجى كتابة كلمة البحث بعد الأمر!\n\nمثال: !بحث رياضيات${signature}`);
                return;
            }

            await message.react('🔍');
            await client.sendMessage(replyTo, `🔍 *جاري البحث عن "${searchTerm}"...*`);

            // البحث في قاعدة البيانات المحلية والأرشيف
            const localResults = lecturesMetadata.filter(lecture => 
                lecture.fileName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                lecture.subject?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                lecture.professor?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                lecture.lectureNumber?.toString().includes(searchTerm) ||
                lecture.pdfType?.toLowerCase().includes(searchTerm.toLowerCase())
            );

            // البحث في الأرشيف
            const archiveResults = searchInArchive(searchTerm);

            // دمج النتائج وإزالة المكررات
            const allResults = [...localResults];
            archiveResults.forEach(archiveItem => {
                if (!localResults.some(local => local.fileName === archiveItem.fileName)) {
                    allResults.push(archiveItem);
                }
            });

            if (allResults.length > 0) {
                let resultsText = `🔍 *نتائج البحث عن "${searchTerm}":*\n\n`;
                allResults.slice(0, 15).forEach((lecture, index) => {
                    resultsText += `${index + 1}. 📚 ${lecture.subject}\n`;
                    resultsText += `   📖 الشعبة: ${lecture.sectionName}\n`;
                    resultsText += `   🏫 الفصل: ${lecture.className}\n`;
                    resultsText += `   📋 المحاضرة: ${lecture.lectureNumber || 'غير محدد'}\n`;
                    resultsText += `   👨‍🏫 الأستاذ: ${lecture.professor}\n`;
                    resultsText += `   👥 الفوج: ${lecture.groupNumber}\n`;
                    resultsText += `   📄 النوع: ${lecture.pdfType}\n\n`;
                });

                if (allResults.length > 15) {
                    resultsText += `... و ${allResults.length - 15} نتائج أخرى\n\n`;
                }

                resultsText += `📥 *لطلب ملف معين، أرسل:*\n!طلب [رقم النتيجة]\n\n💡 *للبحث المتقدم:*\n!بحث_متقدم${signature}`;

                await client.sendMessage(replyTo, resultsText);

                // حفظ نتائج البحث في حالة المستخدم
                userState.set(userId, {
                    step: 'search_results',
                    searchResults: allResults,
                    searchTerm: searchTerm,
                    timestamp: Date.now(),
                    replyTo: replyTo
                });
            } else {
                await client.sendMessage(replyTo, `😔 لم يتم العثور على نتائج للبحث عن "${searchTerm}"\n\n💡 جرب البحث بكلمات مختلفة مثل:\n• اسم المادة\n• اسم الأستاذ\n• رقم المحاضرة\n• نوع الملف (محاضرة/ملخص)${signature}`);
            }
            return;
        }

        // أمر البحث المتقدم - NEW
        if (content === '!بحث_متقدم' || content === '!advanced_search') {
            if (isGroupMessage) {
                await message.react('🔍');
                await client.sendMessage(replyTo, `
🔍 *البحث المتقدم في المحاضرات*
مرحباً ${senderName}! 🙋‍♂️

سنبدأ بالبحث المتقدم حسب المعايير:

أولاً، اختر الشعبة:${signature}`);

                // عرض قائمة الشعب
                let sectionsList = `📚 *اختر الشعبة للبحث المتقدم*\n\n`;
                let index = 1;
                for (const [id, name] of sections) {
                    sectionsList += `${index}. ${name}\n`;
                    index++;
                }
                sectionsList += `\n💡 أرسل رقم الشعبة أو *إلغاء* للخروج${signature}`;
                await client.sendMessage(replyTo, sectionsList);

                userState.set(userId, { 
                    step: 'advanced_search_section', 
                    timestamp: Date.now(),
                    replyTo: replyTo
                });
            } else {
                await message.react('⚠️');
                await client.sendMessage(replyTo, `⚠️ هذا الأمر يعمل في المجموعات فقط!${signature}`);
            }
            return;
        }

        // أمر طلب ملف من نتائج البحث - NEW
        if (content.startsWith('!طلب ') || content.startsWith('!request ')) {
            const state = userState.get(userId);
            if (!state || state.step !== 'search_results') {
                await message.react('⚠️');
                await client.sendMessage(replyTo, `⚠️ يجب عليك البحث أولاً باستخدام أمر !بحث [كلمة البحث]${signature}`);
                return;
            }

            const requestNumber = parseInt(content.substring(content.startsWith('!طلب ') ? 5 : 9).trim());
            if (isNaN(requestNumber) || requestNumber < 1 || requestNumber > state.searchResults.length) {
                await message.react('⚠️');
                await client.sendMessage(replyTo, `⚠️ رقم غير صحيح! يرجى اختيار رقم من 1 إلى ${state.searchResults.length}${signature}`);
                return;
            }

            const requestedLecture = state.searchResults[requestNumber - 1];

            await message.react('📤');
            await client.sendMessage(replyTo, `📤 *جاري البحث وإرسال الملف...*`);

            try {
                // أولاً محاولة البحث في الملفات المحلية
                const filePath = path.join(lecturesDir, requestedLecture.fileName);

                if (fs.existsSync(filePath)) {
                    // إرسال من الملفات المحلية
                    const fileBuffer = fs.readFileSync(filePath);
                    const media = new MessageMedia(
                        'application/pdf',
                        fileBuffer.toString('base64'),
                        requestedLecture.fileName
                    );

                    const caption = `📚 *${requestedLecture.pdfType}*

📖 الشعبة: ${requestedLecture.sectionName}
🏫 الفصل: ${requestedLecture.className}
📚 المادة: ${requestedLecture.subject}
📋 رقم المحاضرة: ${requestedLecture.lectureNumber || 'غير محدد'}
👨‍🏫 الأستاذ: ${requestedLecture.professor}
👥 الفوج: ${requestedLecture.groupNumber}

✅ *تم إرسال الملف في الخاص!*${signature}`;

                    // إرسال في الخاص
                    await client.sendMessage(userId, media, { caption });
                    await client.sendMessage(replyTo, `✅ تم إرسال "${requestedLecture.fileName}" في الخاص!${signature}`);

                } else {
                    // محاولة البحث في الأرشيف
                    const archiveResult = await findAndSendFromArchive({
                        searchTerm: requestedLecture.fileName || requestedLecture.subject,
                        sectionId: requestedLecture.sectionId,
                        classId: requestedLecture.classId,
                        subject: requestedLecture.subject
                    }, userId, senderName);

                    if (archiveResult.success) {
                        await client.sendMessage(replyTo, archiveResult.message + signature);
                    } else {
                        await client.sendMessage(replyTo, `❌ عذراً، لم يتم العثور على الملف المطلوب في الأرشيف.\n\n💡 جرب البحث بكلمة مختلفة أو تواصل مع المشرفين.${signature}`);
                    }
                }

                // تحديث إحصائيات التحميل
                lectureStats.set(userId, (lectureStats.get(userId) || 0) + 1);
                saveStats();

            } catch (error) {
                console.error('[❌] Error sending requested file:', error);
                await client.sendMessage(replyTo, `❌ حدث خطأ أثناء إرسال الملف.\n\nيرجى المحاولة مرة أخرى أو التواصل مع المشرفين.${signature}`);
            }

            // مسح حالة المستخدم
            userState.delete(userId);
            return;
        }

        // أمر إرسال الملف مباشرة - NEW
        if (content.startsWith('!إرسال_مباشر ')) {
            const params = content.substring(14).trim().split(' ');
            if (params.length < 3) {
                await message.react('⚠️');
                await client.sendMessage(replyTo, `⚠️ تنسيق غير صحيح!\n\nالاستخدام: !إرسال_مباشر [الشعبة] [الفصل] [المادة]\n\nمثال: !إرسال_مباشر 1 2 رياضيات${signature}`);
                return;
            }

            const [sectionIndex, classIndex, subject] = params;

            await message.react('📤');
            await client.sendMessage(replyTo, `📤 *جاري البحث عن محاضرات ${subject}...*`);

            // البحث المباشر
            const directResults = lecturesMetadata.filter(lecture => 
                lecture.subject?.toLowerCase().includes(subject.toLowerCase()) &&
                lecture.sectionName?.includes(Array.from(sections.values())[parseInt(sectionIndex) - 1] || '') &&
                lecture.className?.includes(Array.from(classes.values())[parseInt(classIndex) - 1] || '')
            );

            if (directResults.length > 0) {
                let resultsText = `📚 *محاضرات ${subject} المتوفرة:*\n\n`;
                directResults.forEach((lecture, index) => {
                    resultsText += `${index + 1}. 📋 المحاضرة رقم: ${lecture.lectureNumber}\n`;
                    resultsText += `   👨‍🏫 الأستاذ: ${lecture.professor}\n`;
                    resultsText += `   👥 الفوج: ${lecture.groupNumber}\n`;
                    resultsText += `   📄 النوع: ${lecture.pdfType}\n\n`;
                });

                resultsText += `📥 لطلب ملف معين، أرسل: !طلب [رقم المحاضرة]${signature}`;

                await client.sendMessage(replyTo, resultsText);

                userState.set(userId, {
                    step: 'search_results',
                    searchResults: directResults,
                    searchTerm: subject,
                    timestamp: Date.now(),
                    replyTo: replyTo
                });
            } else {
                await client.sendMessage(replyTo, `😔 لم يتم العثور على محاضرات لمادة "${subject}" في الشعبة والفصل المحددين.${signature}`);
            }
            return;
        }



        // Admin panel
        if (!isGroupMessage && userId === OWNER_ID && content === '!Ø¥Ø¯Ø§Ø±Ø©') {
            await message.react('ð¨âð»');
            await client.sendMessage(userId, `
ð¨âð» *ÙÙØ­Ø© Ø§ÙØ¥Ø¯Ø§Ø±Ø©*
Ø§Ø®ØªØ± Ø§ÙØ¹ÙÙÙØ©:
1. Ø¥Ø¶Ø§ÙØ© Ø¹Ø¶Ù/Ø£Ø¹Ø¶Ø§Ø¡
2. Ø­Ø°Ù Ø¹Ø¶Ù
3. ØªØ±ÙÙØ© Ø¹Ø¶Ù ÙÙØ´Ø±Ù
4. Ø®ÙØ¶ ÙØ´Ø±Ù
5. Ø¥Ø¶Ø§ÙØ© ÙØ¨Ø±ÙØ¬
6. Ø­Ø°Ù ÙØ¨Ø±ÙØ¬
7. ØªÙØ¸ÙÙ Ø§ÙÙØ¬ÙÙØ¹Ø©
8. ØªØ«Ø¨ÙØª Ø±Ø³Ø§ÙØ©
9. Ø¥Ø­ØµØ§Ø¦ÙØ§Øª Ø§ÙÙØ¬ÙÙØ¹Ø§Øª
10. ØªØ­ÙÙØ² Ø§ÙÙØ³ØªØ®Ø¯ÙÙÙ
11. ØªØ­ÙÙÙ Ø°ÙØ§Ø¡ Ø§ØµØ·ÙØ§Ø¹Ù
12. Ø¥ÙØ´Ø§Ø¡ ÙØ­ØªÙÙ
13. Ø¬Ø¯ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª (pdfmake)
14. Ø¥Ø¯Ø§Ø±Ø© Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª
15. Ø¥Ø¯Ø§Ø±Ø© Ø§ÙØ´Ø¹Ø¨
16. Ø¥Ø¯Ø§Ø±Ø© Ø§ÙÙØµÙÙ
17. Ø¥Ø¯Ø§Ø±Ø© Ø§ÙØ£ÙÙØ§Ø¬
18. Ø¥Ø¯Ø§Ø±Ø© Ø§ÙØ£Ø³Ø§ØªØ°Ø©
19. Ø¥Ø¯Ø§Ø±Ø© Ø§ÙÙÙØ§Ø¯
20. ØªØ¹Ø¯ÙÙ Ø§ÙØ£ÙØ§ÙØ±
ð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙØ®ÙØ§Ø± Ø£Ù *Ø¥ÙØºØ§Ø¡*${signature}`);
            userState.set(userId, { step: 'admin_menu', timestamp: Date.now() });
            return;
        }

        // Handle PDF upload process
        if (userState.has(userId)) {
            const state = userState.get(userId);

            // Cancel command
            if (content.toLowerCase() === 'Ø¥ÙØºØ§Ø¡') {
                await message.react('â');
                await client.sendMessage(replyTo, `â ØªÙ Ø§ÙØ¥ÙØºØ§Ø¡!${signature}`);
                userState.delete(userId);
                return;
            }

            // Step: Select PDF type
            if (state.step === 'select_pdf_type') {
                const option = parseInt(content);
                if (isNaN(option) || (option !== 1 && option !== 2)) {
                    await message.react('â ï¸');
                    await client.sendMessage(replyTo, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± 1 ÙÙÙØ­Ø§Ø¶Ø±Ø© Ø£Ù 2 ÙÙÙÙØ®Øµ.${signature}`);
                    return;
                }
                
                const pdfType = option === 1 ? 'ÙØ­Ø§Ø¶Ø±Ø©' : 'ÙÙØ®Øµ';
                
                // Update state
                state.pdfType = pdfType;
                state.step = 'select_section';
                userState.set(userId, state);
                
                // Show sections
                let sectionsList = `ð *Ø§Ø®ØªØ± Ø§ÙØ´Ø¹Ø¨Ø©*\n\n`;
                let index = 1;
                for (const [id, name] of sections) {
                    sectionsList += `${index}. ${name}\n`;
                    index++;
                }
                sectionsList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙØ´Ø¹Ø¨Ø© Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;
                await client.sendMessage(replyTo, sectionsList);
                return;
            }

            // Step: Select section
            if (state.step === 'select_section') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > sections.size) {
                    await message.react('â ï¸');
                    await client.sendMessage(replyTo, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙØ´Ø¹Ø¨Ø© Ø§ÙØµØ­ÙØ­.${signature}`);
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
                let classesList = `ð« *Ø§Ø®ØªØ± Ø§ÙÙØµÙ*\n\n`;
                let index = 1;
                for (const [id, name] of classes) {
                    classesList += `${index}. ${name}\n`;
                    index++;
                }
                classesList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙÙØµÙ Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;
                await client.sendMessage(replyTo, classesList);
                return;
            }

            // Step: Select class
            if (state.step === 'select_class') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > classes.size) {
                    await message.react('â ï¸');
                    await client.sendMessage(replyTo, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙÙØµÙ Ø§ÙØµØ­ÙØ­.${signature}`);
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
                let groupsList = `ð¥ *Ø§Ø®ØªØ± Ø§ÙÙÙØ¬*\n\n`;
                let index = 1;
                for (const [id, name] of groupsData) {
                    groupsList += `${index}. ${name}\n`;
                    index++;
                }
                groupsList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙÙÙØ¬ Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;
                await client.sendMessage(replyTo, groupsList);
                return;
            }

            // Step: Select group
            if (state.step === 'select_group') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > groupsData.size) {
                    await message.react('â ï¸');
                    await client.sendMessage(replyTo, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙÙÙØ¬ Ø§ÙØµØ­ÙØ­.${signature}`);
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
                let professorsList = `ð¨âð« *Ø§Ø®ØªØ± Ø§ÙØ£Ø³ØªØ§Ø°*\n\n`;
                let index = 1;
                for (const [id, name] of professors) {
                    professorsList += `${index}. ${name}\n`;
                    index++;
                }
                professorsList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙØ£Ø³ØªØ§Ø° Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;
                await client.sendMessage(replyTo, professorsList);
                return;
            }

            // Step: Select professor
            if (state.step === 'select_professor') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > professors.size) {
                    await message.react('â ï¸');
                    await client.sendMessage(replyTo, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙØ£Ø³ØªØ§Ø° Ø§ÙØµØ­ÙØ­.${signature}`);
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
                let subjectsList = `ð *Ø§Ø®ØªØ± Ø§ÙÙØ§Ø¯Ø©*\n\n`;
                let index = 1;
                for (const [id, name] of subjects) {
                    subjectsList += `${index}. ${name}\n`;
                    index++;
                }
                subjectsList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙÙØ§Ø¯Ø© Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;
                await client.sendMessage(replyTo, subjectsList);
                return;
            }

            // Step: Select subject
            if (state.step === 'select_subject') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > subjects.size) {
                    await message.react('â ï¸');
                    await client.sendMessage(replyTo, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙÙØ§Ø¯Ø© Ø§ÙØµØ­ÙØ­.${signature}`);
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
ð *Ø£Ø¯Ø®Ù Ø±ÙÙ ${state.pdfType}*
ÙØ±Ø¬Ù Ø¥Ø¯Ø®Ø§Ù Ø±ÙÙ ${state.pdfType}:
ð¡ Ø£Ø±Ø³Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`);
                return;
            }

            // Step: Enter lecture number
            if (state.step === 'enter_lecture_number') {
                const lectureNumber = content.trim();
                if (!lectureNumber) {
                    await message.react('â ï¸');
                    await client.sendMessage(replyTo, `â ï¸ ÙØ±Ø¬Ù Ø¥Ø¯Ø®Ø§Ù Ø±ÙÙ ${state.pdfType}!${signature}`);
                    return;
                }
                
                // Update state
                state.lectureNumber = lectureNumber;
                state.step = 'waiting_pdf';
                userState.set(userId, state);
                
                // Ask for PDF file
                await client.sendMessage(replyTo, `
ð *Ø¥Ø±Ø³Ø§Ù ÙÙÙ PDF*
Ø§ÙØ¢Ù ÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù ÙÙÙ PDF ÙÙ ${state.pdfType}:
ð Ø§ÙÙØ§Ø¯Ø©: ${state.subjectName}
ð Ø±ÙÙ ${state.pdfType}: ${state.lectureNumber}
ð¨âð« Ø§ÙØ£Ø³ØªØ§Ø°: ${state.professorName}
ð¥ Ø§ÙÙÙØ¬: ${state.groupName}
ð« Ø§ÙÙØµÙ: ${state.className}
ð Ø§ÙØ´Ø¹Ø¨Ø©: ${state.sectionName}

ð¡ Ø£Ø±Ø³Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`);
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
                        await message.react('â');
                        await client.sendMessage(replyTo, `
â *ØªØ£ÙÙØ¯ Ø¥Ø¶Ø§ÙØ© ${state.pdfType}*
ÙØ±Ø¬Ù ÙØ±Ø§Ø¬Ø¹Ø© Ø§ÙØ¨ÙØ§ÙØ§Øª ÙØ§ÙØªØ£ÙÙØ¯:

ð *Ø§ÙÙØ§Ø¯Ø©:* ${state.subjectName}
ð *Ø±ÙÙ ${state.pdfType}:* ${state.lectureNumber}
ð¨âð« *Ø§ÙØ£Ø³ØªØ§Ø°:* ${state.professorName}
ð¥ *Ø§ÙÙÙØ¬:* ${state.groupName}
ð« *Ø§ÙÙØµÙ:* ${state.className}
ð *Ø§ÙØ´Ø¹Ø¨Ø©:* ${state.sectionName}
ð *Ø§Ø³Ù Ø§ÙÙÙÙ:* ${state.pdfData.filename}

ÙÙ ØªØ±ÙØ¯ Ø¥Ø¶Ø§ÙØ© ÙØ°Ø§ ${state.pdfType}Ø
Ø£Ø±Ø³Ù *ÙØ¹Ù* ÙÙØªØ£ÙÙØ¯ Ø£Ù *ÙØ§* ÙÙØªØ¹Ø¯ÙÙ${signature}`);
                    } else {
                        await message.react('â ï¸');
                        await client.sendMessage(replyTo, `â ï¸ ÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù ÙÙÙ PDF ÙÙØ·!${signature}`);
                    }
                } else {
                    await message.react('â ï¸');
                    await client.sendMessage(replyTo, `â ï¸ ÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù ÙÙÙ PDF!${signature}`);
                }
                return;
            }

            // Step: Confirm PDF
            if (state.step === 'confirm_pdf') {
                if (content.toLowerCase() === 'ÙØ¹Ù') {
                    try {
                        // Create media object
                        const media = new MessageMedia(
                            state.pdfData.mimetype,
                            state.pdfData.data,
                            state.pdfData.filename
                        );

                        // Create formatted message
                        const caption = `
ð *${state.pdfType} Ø¬Ø¯ÙØ¯*

ð *Ø§ÙÙØ§Ø¯Ø©:* ${state.subjectName}
ð *Ø±ÙÙ ${state.pdfType}:* ${state.lectureNumber}
ð¨âð« *Ø§ÙØ£Ø³ØªØ§Ø°:* ${state.professorName}
ð¥ *Ø§ÙÙÙØ¬:* ${state.groupName}
ð« *Ø§ÙÙØµÙ:* ${state.className}
ð *Ø§ÙØ´Ø¹Ø¨Ø©:* ${state.sectionName}
ð¤ *Ø£Ø¶ÙÙ Ø¨ÙØ§Ø³Ø·Ø©:* ${senderName}

ð *ØªØ§Ø±ÙØ® Ø§ÙØ¥Ø¶Ø§ÙØ©:* ${new Date().toLocaleDateString('ar-EG')}
${signature}`;

                        // Send to PDF archive group
                        await client.sendMessage(PDF_ARCHIVE_GROUP, media, { caption });

        // إضافة الملف للأرشيف التلقائي - NEW
        try {
            const archiveId = await addToArchive({
                pdfType: state.pdfType,
                sectionId: state.sectionId,
                classId: state.classId,
                sectionName: state.sectionName,
                className: state.className,
                subject: state.subject,
                lectureNumber: state.lectureNumber,
                professor: state.professor,
                groupNumber: state.groupNumber,
                fileName: fileName,
                mediaData: media.data,
                uploaderName: senderName,
                uploaderId: userId
            }, message.id._serialized);

            if (archiveId) {
                console.log(`[📂] File added to automatic archive: ${archiveId}`);
            }
        } catch (archiveError) {
            console.error('[❌] Error adding to automatic archive:', archiveError);
        }
                        
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
                        await message.react('â');
                        await client.sendMessage(replyTo, `
â *ØªÙØª Ø¥Ø¶Ø§ÙØ© ${state.pdfType} Ø¨ÙØ¬Ø§Ø­!*
Ø´ÙØ±Ø§Ù ${senderName}! ð
ØªÙ Ø¥Ø±Ø³Ø§Ù Ø§ÙÙÙÙ ÙØ§ÙÙØ¹ÙÙÙØ§Øª Ø¥ÙÙ ÙØ¬ÙÙØ¹Ø© Ø§ÙØ£Ø±Ø´ÙÙ.${signature}`);

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
                        console.error('[â] Error saving PDF:', error);
                        await client.sendMessage(replyTo, `â ï¸ Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ Ø­ÙØ¸ Ø§ÙÙÙÙ: ${error.message}${signature}`);
                    }
                } else if (content.toLowerCase() === 'ÙØ§') {
                    // Go back to lecture number step
                    state.step = 'enter_lecture_number';
                    userState.set(userId, state);
                    await client.sendMessage(replyTo, `â ØªÙ Ø§ÙØ¥ÙØºØ§Ø¡. ÙØ±Ø¬Ù Ø¥Ø¯Ø®Ø§Ù Ø±ÙÙ ${state.pdfType} ÙØ±Ø© Ø£Ø®Ø±Ù:${signature}`);
                } else {
                    await message.react('â ï¸');
                    await client.sendMessage(replyTo, `â ï¸ ÙØ±Ø¬Ù Ø§ÙØ±Ø¯ Ø¨Ù "ÙØ¹Ù" Ø£Ù "ÙØ§" ÙÙØ·!${signature}`);
                }
                return;
            }

            // Handle admin menu
            if (state.step === 'admin_menu') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 20) {
                    await message.react('â ï¸');
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ ÙÙ 1 Ø¥ÙÙ 20.${signature}`);
                    return;
                }

                switch (option) {
                    case 1: // Add member
                        await client.sendMessage(userId, `ð¥ *Ø¥Ø¶Ø§ÙØ© Ø¹Ø¶Ù*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø±ÙÙ Ø§ÙÙØ§ØªÙ ÙØ¹ Ø±ÙØ² Ø§ÙØ¨ÙØ¯ (ÙØ«Ù: +212123456789):${signature}`);
                        state.step = 'add_member';
                        userState.set(userId, state);
                        break;
                        
                    case 2: // Remove member
                        await client.sendMessage(userId, `ð¤ *Ø­Ø°Ù Ø¹Ø¶Ù*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø±ÙÙ Ø§ÙÙØ§ØªÙ ÙØ¹ Ø±ÙØ² Ø§ÙØ¨ÙØ¯ (ÙØ«Ù: +212123456789):${signature}`);
                        state.step = 'remove_member';
                        userState.set(userId, state);
                        break;
                        
                    case 3: // Promote to admin
                        await client.sendMessage(userId, `â¬ï¸ *ØªØ±ÙÙØ© Ø¹Ø¶Ù*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø±ÙÙ Ø§ÙÙØ§ØªÙ ÙØ¹ Ø±ÙØ² Ø§ÙØ¨ÙØ¯ (ÙØ«Ù: +212123456789):${signature}`);
                        state.step = 'promote_admin';
                        userState.set(userId, state);
                        break;
                        
                    case 4: // Demote admin
                        await client.sendMessage(userId, `â¬ï¸ *Ø®ÙØ¶ ÙØ´Ø±Ù*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø±ÙÙ Ø§ÙÙØ§ØªÙ ÙØ¹ Ø±ÙØ² Ø§ÙØ¨ÙØ¯ (ÙØ«Ù: +212123456789):${signature}`);
                        state.step = 'demote_admin';
                        userState.set(userId, state);
                        break;
                        
                    case 5: // Add programmer
                        await client.sendMessage(userId, `ð¨âð» *Ø¥Ø¶Ø§ÙØ© ÙØ¨Ø±ÙØ¬*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø±ÙÙ Ø§ÙÙØ§ØªÙ ÙØ¹ Ø±ÙØ² Ø§ÙØ¨ÙØ¯ (ÙØ«Ù: +212123456789):${signature}`);
                        state.step = 'add_programmer';
                        userState.set(userId, state);
                        break;
                        
                    case 6: // Remove programmer
                        await client.sendMessage(userId, `ð« *Ø­Ø°Ù ÙØ¨Ø±ÙØ¬*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø±ÙÙ Ø§ÙÙØ§ØªÙ ÙØ¹ Ø±ÙØ² Ø§ÙØ¨ÙØ¯ (ÙØ«Ù: +212123456789):${signature}`);
                        state.step = 'remove_programmer';
                        userState.set(userId, state);
                        break;
                        
                    case 7: // Clean group
                        await client.sendMessage(userId, `ð§¹ *ØªÙØ¸ÙÙ Ø§ÙÙØ¬ÙÙØ¹Ø©*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù ÙØ¹Ø±Ù Ø§ÙÙØ¬ÙÙØ¹Ø© (ÙØ«Ù: 123456789@g.us):${signature}`);
                        state.step = 'clean_group';
                        userState.set(userId, state);
                        break;
                        
                    case 8: // Pin message
                        await client.sendMessage(userId, `ð *ØªØ«Ø¨ÙØª Ø±Ø³Ø§ÙØ©*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù ÙØ¹Ø±Ù Ø§ÙÙØ¬ÙÙØ¹Ø© (ÙØ«Ù: 123456789@g.us):${signature}`);
                        state.step = 'pin_message_group';
                        userState.set(userId, state);
                        break;
                        
                    case 9: // Group statistics
                        await client.sendMessage(userId, `ð *Ø¥Ø­ØµØ§Ø¦ÙØ§Øª Ø§ÙÙØ¬ÙÙØ¹Ø§Øª*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù ÙØ¹Ø±Ù Ø§ÙÙØ¬ÙÙØ¹Ø© (ÙØ«Ù: 123456789@g.us):${signature}`);
                        state.step = 'group_stats';
                        userState.set(userId, state);
                        break;
                        
                    case 10: // Motivate users
                        await client.sendMessage(userId, `ð¯ *ØªØ­ÙÙØ² Ø§ÙÙØ³ØªØ®Ø¯ÙÙÙ*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù ÙØ¹Ø±Ù Ø§ÙÙØ¬ÙÙØ¹Ø© (ÙØ«Ù: 123456789@g.us):${signature}`);
                        state.step = 'motivate_users';
                        userState.set(userId, state);
                        break;
                        
                    case 11: // AI analysis
                        await client.sendMessage(userId, `ð *ØªØ­ÙÙÙ Ø°ÙØ§Ø¡ Ø§ØµØ·ÙØ§Ø¹Ù*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù ÙØ¹Ø±Ù Ø§ÙÙØ¬ÙÙØ¹Ø© (ÙØ«Ù: 123456789@g.us):${signature}`);
                        state.step = 'ai_analysis';
                        userState.set(userId, state);
                        break;
                        
                    case 12: // Generate content
                        await client.sendMessage(userId, `âï¸ *Ø¥ÙØ´Ø§Ø¡ ÙØ­ØªÙÙ*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù ÙØµÙ Ø§ÙÙØ­ØªÙÙ Ø§ÙØ°Ù ØªØ±ÙØ¯ Ø¥ÙØ´Ø§Ø¡Ù:${signature}`);
                        state.step = 'generate_content';
                        userState.set(userId, state);
                        break;
                        
                    case 13: // Lectures table
                        await message.react('ð');
                        await client.sendMessage(userId, `ð *Ø¬Ø§Ø±Ù Ø¥ÙØ´Ø§Ø¡ Ø¬Ø¯ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª...*${signature}`);
                        try {
                            if (lecturesMetadata.length === 0) {
                                await client.sendMessage(userId, `â ï¸ ÙØ§ ØªÙØ¬Ø¯ ÙØ­Ø§Ø¶Ø±Ø§Øª ÙØ¶Ø§ÙØ© Ø¨Ø¹Ø¯!${signature}`);
                                await message.react('â');
                                return;
                            }
                            
                            const pdfBuffer = await generateLecturesTablePDF(lecturesMetadata);
                            const media = new MessageMedia(
                                'application/pdf',
                                pdfBuffer.toString('base64'),
                                `Ø¬Ø¯ÙÙ_Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª_${new Date().toISOString().split('T')[0]}.pdf`
                            );
                            
                            await client.sendMessage(userId, media, {
                                caption: `ð *Ø¬Ø¯ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª*\n\nØªÙ Ø¥ÙØ´Ø§Ø¡ Ø§ÙØ¬Ø¯ÙÙ Ø¨Ø§Ø³ØªØ®Ø¯Ø§Ù pdfmake!\nð Ø§ÙØªØ§Ø±ÙØ®: ${new Date().toLocaleDateString('ar-EG')}\nð Ø¹Ø¯Ø¯ Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª: ${lecturesMetadata.length}\nð¤ ØªÙ Ø¥ÙØ´Ø§Ø¤Ù Ø¨ÙØ§Ø³Ø·Ø© Gemini AI${signature}`
                            });
                            
                            await message.react('â');
                        } catch (error) {
                            console.error('[â] Error generating lectures table:', error);
                            await client.sendMessage(userId, `â ï¸ Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ Ø¥ÙØ´Ø§Ø¡ Ø¬Ø¯ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª: ${error.message}${signature}`);
                            await message.react('â');
                        }
                        userState.delete(userId);
                        break;
                        
                    case 14: // Manage lectures
                        await client.sendMessage(userId, `ð *Ø¥Ø¯Ø§Ø±Ø© Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª*\n\nØ§Ø®ØªØ± Ø§ÙØ¹ÙÙÙØ©:\n1. Ø¹Ø±Ø¶ Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª\n2. Ø­Ø°Ù ÙØ­Ø§Ø¶Ø±Ø©\n3. ØªØ¹Ø¯ÙÙ ÙØ­Ø§Ø¶Ø±Ø©${signature}`);
                        state.step = 'manage_lectures';
                        userState.set(userId, state);
                        break;
                        
                    case 15: // Manage sections
                        await client.sendMessage(userId, `ð *Ø¥Ø¯Ø§Ø±Ø© Ø§ÙØ´Ø¹Ø¨*\n\nØ§Ø®ØªØ± Ø§ÙØ¹ÙÙÙØ©:\n1. Ø¹Ø±Ø¶ Ø§ÙØ´Ø¹Ø¨\n2. Ø¥Ø¶Ø§ÙØ© Ø´Ø¹Ø¨Ø©\n3. Ø­Ø°Ù Ø´Ø¹Ø¨Ø©\n4. ØªØ¹Ø¯ÙÙ Ø´Ø¹Ø¨Ø©${signature}`);
                        state.step = 'manage_sections';
                        userState.set(userId, state);
                        break;
                        
                    case 16: // Manage classes
                        await client.sendMessage(userId, `ð« *Ø¥Ø¯Ø§Ø±Ø© Ø§ÙÙØµÙÙ*\n\nØ§Ø®ØªØ± Ø§ÙØ¹ÙÙÙØ©:\n1. Ø¹Ø±Ø¶ Ø§ÙÙØµÙÙ\n2. Ø¥Ø¶Ø§ÙØ© ÙØµÙ\n3. Ø­Ø°Ù ÙØµÙ\n4. ØªØ¹Ø¯ÙÙ ÙØµÙ${signature}`);
                        state.step = 'manage_classes';
                        userState.set(userId, state);
                        break;
                        
                    case 17: // Manage groups
                        await client.sendMessage(userId, `ð¥ *Ø¥Ø¯Ø§Ø±Ø© Ø§ÙØ£ÙÙØ§Ø¬*\n\nØ§Ø®ØªØ± Ø§ÙØ¹ÙÙÙØ©:\n1. Ø¹Ø±Ø¶ Ø§ÙØ£ÙÙØ§Ø¬\n2. Ø¥Ø¶Ø§ÙØ© ÙÙØ¬\n3. Ø­Ø°Ù ÙÙØ¬\n4. ØªØ¹Ø¯ÙÙ ÙÙØ¬${signature}`);
                        state.step = 'manage_groups';
                        userState.set(userId, state);
                        break;
                        
                    case 18: // Manage professors
                        await client.sendMessage(userId, `ð¨âð« *Ø¥Ø¯Ø§Ø±Ø© Ø§ÙØ£Ø³Ø§ØªØ°Ø©*\n\nØ§Ø®ØªØ± Ø§ÙØ¹ÙÙÙØ©:\n1. Ø¹Ø±Ø¶ Ø§ÙØ£Ø³Ø§ØªØ°Ø©\n2. Ø¥Ø¶Ø§ÙØ© Ø£Ø³ØªØ§Ø°\n3. Ø­Ø°Ù Ø£Ø³ØªØ§Ø°\n4. ØªØ¹Ø¯ÙÙ Ø£Ø³ØªØ§Ø°${signature}`);
                        state.step = 'manage_professors';
                        userState.set(userId, state);
                        break;
                        
                    case 19: // Manage subjects
                        await client.sendMessage(userId, `ð *Ø¥Ø¯Ø§Ø±Ø© Ø§ÙÙÙØ§Ø¯*\n\nØ§Ø®ØªØ± Ø§ÙØ¹ÙÙÙØ©:\n1. Ø¹Ø±Ø¶ Ø§ÙÙÙØ§Ø¯\n2. Ø¥Ø¶Ø§ÙØ© ÙØ§Ø¯Ø©\n3. Ø­Ø°Ù ÙØ§Ø¯Ø©\n4. ØªØ¹Ø¯ÙÙ ÙØ§Ø¯Ø©${signature}`);
                        state.step = 'manage_subjects';
                        userState.set(userId, state);
                        break;
                        
                    case 20: // Edit commands
                        await client.sendMessage(userId, `âï¸ *ØªØ¹Ø¯ÙÙ Ø§ÙØ£ÙØ§ÙØ±*\n\nØ§Ø®ØªØ± Ø§ÙØ£ÙØ± Ø§ÙØ°Ù ØªØ±ÙØ¯ ØªØ¹Ø¯ÙÙÙ:\n1. !ask\n2. !analyze\n3. !generate\n4. !Ø¬Ø¯ÙÙ_Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª\n5. !ØªØ«Ø¨ÙØª\n6. !Ø§Ø¶Ø§ÙØ©_pdf\n7. !ØªØ­ÙÙÙ\n8. !Ø¥Ø¯Ø§Ø±Ø©\n9. !commands${signature}`);
                        state.step = 'edit_commands';
                        userState.set(userId, state);
                        break;
                }
                return;
            }

            // Handle admin operations
            // Add member
            if (state.step === 'add_member') {
                const phoneNumber = formatPhoneNumber(content);
                await client.sendMessage(userId, `ð¥ *Ø¥Ø¶Ø§ÙØ© Ø¹Ø¶Ù*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù ÙØ¹Ø±Ù Ø§ÙÙØ¬ÙÙØ¹Ø© (ÙØ«Ù: 123456789@g.us):${signature}`);
                state.phoneNumber = phoneNumber;
                state.step = 'add_member_group';
                userState.set(userId, state);
                return;
            }

            if (state.step === 'add_member_group') {
                const groupId = content;
                try {
                    await client.addParticipant(groupId, state.phoneNumber);
                    await client.sendMessage(userId, `â ØªÙØª Ø¥Ø¶Ø§ÙØ© ${state.phoneNumber} Ø¥ÙÙ Ø§ÙÙØ¬ÙÙØ¹Ø© ${groupId}${signature}`);
                    userState.delete(userId);
                } catch (error) {
                    console.error('[â] Error adding member:', error);
                    await client.sendMessage(userId, `â ï¸ Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ Ø¥Ø¶Ø§ÙØ© Ø§ÙØ¹Ø¶Ù: ${error.message}${signature}`);
                }
                return;
            }

            // Remove member
            if (state.step === 'remove_member') {
                const phoneNumber = formatPhoneNumber(content);
                await client.sendMessage(userId, `ð¤ *Ø­Ø°Ù Ø¹Ø¶Ù*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù ÙØ¹Ø±Ù Ø§ÙÙØ¬ÙÙØ¹Ø© (ÙØ«Ù: 123456789@g.us):${signature}`);
                state.phoneNumber = phoneNumber;
                state.step = 'remove_member_group';
                userState.set(userId, state);
                return;
            }

            if (state.step === 'remove_member_group') {
                const groupId = content;
                try {
                    await client.removeParticipant(groupId, state.phoneNumber);
                    await client.sendMessage(userId, `â ØªÙØª Ø¥Ø²Ø§ÙØ© ${state.phoneNumber} ÙÙ Ø§ÙÙØ¬ÙÙØ¹Ø© ${groupId}${signature}`);
                    userState.delete(userId);
                } catch (error) {
                    console.error('[â] Error removing member:', error);
                    await client.sendMessage(userId, `â ï¸ Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ Ø­Ø°Ù Ø§ÙØ¹Ø¶Ù: ${error.message}${signature}`);
                }
                return;
            }

            // Promote to admin
            if (state.step === 'promote_admin') {
                const phoneNumber = formatPhoneNumber(content);
                await client.sendMessage(userId, `â¬ï¸ *ØªØ±ÙÙØ© Ø¹Ø¶Ù*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù ÙØ¹Ø±Ù Ø§ÙÙØ¬ÙÙØ¹Ø© (ÙØ«Ù: 123456789@g.us):${signature}`);
                state.phoneNumber = phoneNumber;
                state.step = 'promote_admin_group';
                userState.set(userId, state);
                return;
            }

            if (state.step === 'promote_admin_group') {
                const groupId = content;
                try {
                    await client.promoteParticipant(groupId, state.phoneNumber);
                    await client.sendMessage(userId, `â ØªÙØª ØªØ±ÙÙØ© ${state.phoneNumber} Ø¥ÙÙ ÙØ´Ø±Ù ÙÙ Ø§ÙÙØ¬ÙÙØ¹Ø© ${groupId}${signature}`);
                    userState.delete(userId);
                } catch (error) {
                    console.error('[â] Error promoting member:', error);
                    await client.sendMessage(userId, `â ï¸ Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ ØªØ±ÙÙØ© Ø§ÙØ¹Ø¶Ù: ${error.message}${signature}`);
                }
                return;
            }

            // Demote admin
            if (state.step === 'demote_admin') {
                const phoneNumber = formatPhoneNumber(content);
                await client.sendMessage(userId, `â¬ï¸ *Ø®ÙØ¶ ÙØ´Ø±Ù*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù ÙØ¹Ø±Ù Ø§ÙÙØ¬ÙÙØ¹Ø© (ÙØ«Ù: 123456789@g.us):${signature}`);
                state.phoneNumber = phoneNumber;
                state.step = 'demote_admin_group';
                userState.set(userId, state);
                return;
            }

            if (state.step === 'demote_admin_group') {
                const groupId = content;
                try {
                    await client.demoteParticipant(groupId, state.phoneNumber);
                    await client.sendMessage(userId, `â ØªÙØª Ø®ÙØ¶ ${state.phoneNumber} ÙÙ ÙØ´Ø±Ù ÙÙ Ø§ÙÙØ¬ÙÙØ¹Ø© ${groupId}${signature}`);
                    userState.delete(userId);
                } catch (error) {
                    console.error('[â] Error demoting member:', error);
                    await client.sendMessage(userId, `â ï¸ Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ Ø®ÙØ¶ Ø§ÙÙØ´Ø±Ù: ${error.message}${signature}`);
                }
                return;
            }

            // Add programmer
            if (state.step === 'add_programmer') {
                const phoneNumber = formatPhoneNumber(content);
                admins.add(phoneNumber);
                saveAdmins();
                await client.sendMessage(userId, `â ØªÙØª Ø¥Ø¶Ø§ÙØ© ${phoneNumber} Ø¥ÙÙ ÙØ§Ø¦ÙØ© Ø§ÙÙØ¨Ø±ÙØ¬ÙÙ${signature}`);
                userState.delete(userId);
                return;
            }

            // Remove programmer
            if (state.step === 'remove_programmer') {
                const phoneNumber = formatPhoneNumber(content);
                admins.delete(phoneNumber);
                saveAdmins();
                await client.sendMessage(userId, `â ØªÙØª Ø¥Ø²Ø§ÙØ© ${phoneNumber} ÙÙ ÙØ§Ø¦ÙØ© Ø§ÙÙØ¨Ø±ÙØ¬ÙÙ${signature}`);
                userState.delete(userId);
                return;
            }

            // Clean group
            if (state.step === 'clean_group') {
                const groupId = content;
                try {
                    const chat = await client.getChatById(groupId);
                    const participants = chat.participants;
                    
                    for (const participant of participants) {
                        if (!participant.isAdmin && !participant.isSuperAdmin) {
                            await client.removeParticipant(groupId, participant.id._serialized);
                        }
                    }
                    
                    await client.sendMessage(userId, `â ØªÙ ØªÙØ¸ÙÙ Ø§ÙÙØ¬ÙÙØ¹Ø© ${groupId}${signature}`);
                    userState.delete(userId);
                } catch (error) {
                    console.error('[â] Error cleaning group:', error);
                    await client.sendMessage(userId, `â ï¸ Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ ØªÙØ¸ÙÙ Ø§ÙÙØ¬ÙÙØ¹Ø©: ${error.message}${signature}`);
                }
                return;
            }

            // Pin message
            if (state.step === 'pin_message_group') {
                const groupId = content;
                await client.sendMessage(userId, `ð *ØªØ«Ø¨ÙØª Ø±Ø³Ø§ÙØ©*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø±Ø³Ø§ÙØ© ÙØªØ«Ø¨ÙØªÙØ§:${signature}`);
                state.groupId = groupId;
                state.step = 'pin_message_text';
                userState.set(userId, state);
                return;
            }

            if (state.step === 'pin_message_text') {
                try {
                    const message = await client.sendMessage(state.groupId, content);
                    await message.pin();
                    await client.sendMessage(userId, `â ØªÙ ØªØ«Ø¨ÙØª Ø§ÙØ±Ø³Ø§ÙØ© ÙÙ Ø§ÙÙØ¬ÙÙØ¹Ø© ${state.groupId}${signature}`);
                    userState.delete(userId);
                } catch (error) {
                    console.error('[â] Error pinning message:', error);
                    await client.sendMessage(userId, `â ï¸ Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ ØªØ«Ø¨ÙØª Ø§ÙØ±Ø³Ø§ÙØ©: ${error.message}${signature}`);
                }
                return;
            }

            // Group statistics
            if (state.step === 'group_stats') {
                const groupId = content;
                try {
                    const chat = await client.getChatById(groupId);
                    const participants = chat.participants;
                    const joins = joinStats.get(groupId) || [];
                    const leaves = leaveStats.get(groupId) || [];
                    const messages = messageStats.get(groupId) || [];
                    
                    const stats = `
ð *Ø¥Ø­ØµØ§Ø¦ÙØ§Øª Ø§ÙÙØ¬ÙÙØ¹Ø©: ${chat.name}*

ð¥ *Ø¹Ø¯Ø¯ Ø§ÙØ£Ø¹Ø¶Ø§Ø¡:* ${participants.length}
ð *Ø§ÙØ§ÙØ¶ÙØ§ÙØ§Øª:* ${joins.length}
ð *Ø§ÙÙØºØ§Ø¯Ø±Ø§Øª:* ${leaves.length}
ð¬ *Ø§ÙØ±Ø³Ø§Ø¦Ù:* ${messages.length}
ð *ØªØ§Ø±ÙØ® Ø§ÙØ¥ÙØ´Ø§Ø¡:* ${new Date(chat.createdAt * 1000).toLocaleDateString('ar-EG')}
${signature}`;
                    
                    await client.sendMessage(userId, stats);
                    userState.delete(userId);
                } catch (error) {
                    console.error('[â] Error getting group stats:', error);
                    await client.sendMessage(userId, `â ï¸ Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ Ø¬ÙØ¨ Ø¥Ø­ØµØ§Ø¦ÙØ§Øª Ø§ÙÙØ¬ÙÙØ¹Ø©: ${error.message}${signature}`);
                }
                return;
            }

            // Motivate users
            if (state.step === 'motivate_users') {
                const groupId = content;
                try {
                    const chat = await client.getChatById(groupId);
                    const participants = chat.participants;
                    
                    const motivationMessages = [
                        "ð Ø§Ø³ØªÙØ±ÙØ§ ÙÙ Ø§ÙØªÙÙÙ! Ø£ÙØªÙ Ø§ÙØ£ÙØ¶Ù!",
                        "ð ÙØ§ ØªÙÙÙÙØ§ Ø¹Ù Ø§ÙØ·ÙÙØ­! Ø§ÙØ³ÙØ§Ø¡ ÙÙØ³Øª Ø§ÙØ­Ø¯!",
                        "ðª ÙÙ ÙÙÙ ÙÙ ÙØ±ØµØ© Ø¬Ø¯ÙØ¯Ø© ÙÙÙØ¬Ø§Ø­!",
                        "ð¯ Ø§Ø³ØªÙØ¯ÙÙØ§ Ø§ÙÙØ¬Ø§Ø­ ÙØ³ÙÙ ØªØ­ÙÙÙÙÙ!",
                        "ð Ø¨Ø¹Ø¯ ÙÙ Ø¹ØªÙØ© ÙØ£ØªÙ Ø§ÙÙØ¬Ø±!"
                    ];
                    
                    const randomMessage = motivationMessages[Math.floor(Math.random() * motivationMessages.length)];
                    
                    await client.sendMessage(groupId, randomMessage + signature);
                    await client.sendMessage(userId, `â ØªÙ Ø¥Ø±Ø³Ø§Ù Ø±Ø³Ø§ÙØ© ØªØ­ÙÙØ²ÙØ© Ø¥ÙÙ Ø§ÙÙØ¬ÙÙØ¹Ø© ${groupId}${signature}`);
                    userState.delete(userId);
                } catch (error) {
                    console.error('[â] Error motivating users:', error);
                    await client.sendMessage(userId, `â ï¸ Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ Ø¥Ø±Ø³Ø§Ù Ø±Ø³Ø§ÙØ© Ø§ÙØªØ­ÙÙØ²: ${error.message}${signature}`);
                }
                return;
            }

            // AI analysis
            if (state.step === 'ai_analysis') {
                const groupId = content;
                try {
                    const chat = await client.getChatById(groupId);
                    const messages = await chat.fetchMessages({ limit: 20 });
                    
                    let analysis = `ð *ØªØ­ÙÙÙ Ø°ÙØ§Ø¡ Ø§ØµØ·ÙØ§Ø¹Ù ÙÙÙØ¬ÙÙØ¹Ø©: ${chat.name}*\n\n`;
                    
                    for (const msg of messages.reverse()) {
                        if (msg.body && !msg.body.startsWith('!')) {
                            const contact = await msg.getContact();
                            const senderName = contact.pushname || contact.name || "User";
                            
                            const intentAnalysis = await analyzeUserIntent(msg.body, senderName, true, chat.name);
                            
                            if (intentAnalysis.confidence > 0.7) {
                                analysis += `ð¤ ${senderName}: ${msg.body}\n`;
                                analysis += `ð¯ Ø§ÙÙÙØ©: ${intentAnalysis.intent}\n`;
                                analysis += `ð¬ Ø§ÙØ±Ø¯ Ø§ÙÙÙØªØ±Ø­: ${intentAnalysis.response}\n\n`;
                            }
                        }
                    }
                    
                    await client.sendMessage(userId, analysis + signature);
                    userState.delete(userId);
                } catch (error) {
                    console.error('[â] Error in AI analysis:', error);
                    await client.sendMessage(userId, `â ï¸ Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ Ø§ÙØªØ­ÙÙÙ: ${error.message}${signature}`);
                }
                return;
            }

            // Generate content
            if (state.step === 'generate_content') {
                try {
                    const aiResponse = await askGemini(`Ø£ÙØ´Ø¦ ÙØ­ØªÙÙ Ø¨ÙØ§Ø¡Ù Ø¹ÙÙ Ø§ÙÙØµÙ Ø§ÙØªØ§ÙÙ: ${content}`);
                    await client.sendMessage(userId, `âï¸ *Ø§ÙÙØ­ØªÙÙ Ø§ÙØ°Ù ØªÙ Ø¥ÙØ´Ø§Ø¤Ù:*\n\n${aiResponse}${signature}`);
                    userState.delete(userId);
                } catch (error) {
                    console.error('[â] Error generating content:', error);
                    await client.sendMessage(userId, `â ï¸ Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«ÙØ§Ø¡ Ø¥ÙØ´Ø§Ø¡ Ø§ÙÙØ­ØªÙÙ: ${error.message}${signature}`);
                }
                return;
            }

            // Manage lectures
            if (state.step === 'manage_lectures') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 3) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ ÙÙ 1 Ø¥ÙÙ 3.${signature}`);
                    return;
                }

                switch (option) {
                    case 1: // Show lectures
                        if (lecturesMetadata.length === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ØªÙØ¬Ø¯ ÙØ­Ø§Ø¶Ø±Ø§Øª ÙØ¶Ø§ÙØ© Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let lectureList = `ð *ÙØ§Ø¦ÙØ© Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª:*\n\n`;
                        lecturesMetadata.forEach((lecture, index) => {
                            lectureList += `${index + 1}. ${lecture.subject} - ${lecture.type} ${lecture.lectureNumber}\n`;
                            lectureList += `   ð Ø§ÙØ´Ø¹Ø¨Ø©: ${lecture.sectionName}\n`;
                            lectureList += `   ð« Ø§ÙÙØµÙ: ${lecture.className}\n`;
                            lectureList += `   ð¥ Ø§ÙÙÙØ¬: ${lecture.groupNumber}\n`;
                            lectureList += `   ð¨âð« Ø§ÙØ£Ø³ØªØ§Ø°: ${lecture.professor}\n`;
                            lectureList += `   ð Ø§ÙØªØ§Ø±ÙØ®: ${new Date(lecture.date).toLocaleDateString('ar-EG')}\n\n`;
                        });

                        await client.sendMessage(userId, lectureList + signature);
                        userState.delete(userId);
                        break;

                    case 2: // Delete lecture
                        if (lecturesMetadata.length === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ØªÙØ¬Ø¯ ÙØ­Ø§Ø¶Ø±Ø§Øª ÙØ¶Ø§ÙØ© Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let deleteList = `ðï¸ *Ø­Ø°Ù ÙØ­Ø§Ø¶Ø±Ø©*\n\nØ§Ø®ØªØ± Ø§ÙÙØ­Ø§Ø¶Ø±Ø© Ø§ÙØªÙ ØªØ±ÙØ¯ Ø­Ø°ÙÙØ§:\n\n`;
                        lecturesMetadata.forEach((lecture, index) => {
                            deleteList += `${index + 1}. ${lecture.subject} - ${lecture.type} ${lecture.lectureNumber}\n`;
                        });
                        deleteList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø© Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;

                        await client.sendMessage(userId, deleteList);
                        state.step = 'delete_lecture';
                        userState.set(userId, state);
                        break;

                    case 3: // Edit lecture
                        if (lecturesMetadata.length === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ØªÙØ¬Ø¯ ÙØ­Ø§Ø¶Ø±Ø§Øª ÙØ¶Ø§ÙØ© Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let editList = `âï¸ *ØªØ¹Ø¯ÙÙ ÙØ­Ø§Ø¶Ø±Ø©*\n\nØ§Ø®ØªØ± Ø§ÙÙØ­Ø§Ø¶Ø±Ø© Ø§ÙØªÙ ØªØ±ÙØ¯ ØªØ¹Ø¯ÙÙÙØ§:\n\n`;
                        lecturesMetadata.forEach((lecture, index) => {
                            editList += `${index + 1}. ${lecture.subject} - ${lecture.type} ${lecture.lectureNumber}\n`;
                        });
                        editList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø© Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;

                        await client.sendMessage(userId, editList);
                        state.step = 'edit_lecture';
                        userState.set(userId, state);
                        break;
                }
                return;
            }

            // Delete lecture
            if (state.step === 'delete_lecture') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > lecturesMetadata.length) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø© Ø§ÙØµØ­ÙØ­.${signature}`);
                    return;
                }

                const deletedLecture = lecturesMetadata[option - 1];
                lecturesMetadata.splice(option - 1, 1);
                saveLectures();

                await client.sendMessage(userId, `â ØªÙ Ø­Ø°Ù Ø§ÙÙØ­Ø§Ø¶Ø±Ø©: ${deletedLecture.subject} - ${deletedLecture.type} ${deletedLecture.lectureNumber}${signature}`);
                userState.delete(userId);
                return;
            }

            // Edit lecture
            if (state.step === 'edit_lecture') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > lecturesMetadata.length) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø© Ø§ÙØµØ­ÙØ­.${signature}`);
                    return;
                }

                const lecture = lecturesMetadata[option - 1];
                await client.sendMessage(userId, `
âï¸ *ØªØ¹Ø¯ÙÙ ÙØ­Ø§Ø¶Ø±Ø©*
Ø§ÙÙØ­Ø§Ø¶Ø±Ø© Ø§ÙØ­Ø§ÙÙØ©: ${lecture.subject} - ${lecture.type} ${lecture.lectureNumber}

Ø§Ø®ØªØ± ÙØ§ ØªØ±ÙØ¯ ØªØ¹Ø¯ÙÙÙ:
1. Ø§ÙÙØ§Ø¯Ø©
2. Ø±ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø©
3. Ø§ÙØ£Ø³ØªØ§Ø°
4. Ø§ÙÙÙØ¬
5. Ø§ÙÙØµÙ
6. Ø§ÙØ´Ø¹Ø¨Ø©
ð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙØ®ÙØ§Ø± Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`);
                state.lectureIndex = option - 1;
                state.step = 'edit_lecture_field';
                userState.set(userId, state);
                return;
            }

            // Edit lecture field
            if (state.step === 'edit_lecture_field') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 6) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ ÙÙ 1 Ø¥ÙÙ 6.${signature}`);
                    return;
                }

                const fieldNames = {
                    1: 'Ø§ÙÙØ§Ø¯Ø©',
                    2: 'Ø±ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø©',
                    3: 'Ø§ÙØ£Ø³ØªØ§Ø°',
                    4: 'Ø§ÙÙÙØ¬',
                    5: 'Ø§ÙÙØµÙ',
                    6: 'Ø§ÙØ´Ø¹Ø¨Ø©'
                };

                await client.sendMessage(userId, `âï¸ *ØªØ¹Ø¯ÙÙ ${fieldNames[option]}*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§ÙÙÙÙØ© Ø§ÙØ¬Ø¯ÙØ¯Ø©:${signature}`);
                state.editField = option;
                state.step = 'edit_lecture_value';
                userState.set(userId, state);
                return;
            }

            // Edit lecture value
            if (state.step === 'edit_lecture_value') {
                const lecture = lecturesMetadata[state.lectureIndex];
                
                switch (state.editField) {
                    case 1: // Subject
                        lecture.subject = content;
                        break;
                    case 2: // Lecture number
                        lecture.lectureNumber = content;
                        break;
                    case 3: // Professor
                        lecture.professor = content;
                        break;
                    case 4: // Group
                        lecture.groupNumber = content;
                        break;
                    case 5: // Class
                        lecture.className = content;
                        break;
                    case 6: // Section
                        lecture.sectionName = content;
                        break;
                }

                saveLectures();
                await client.sendMessage(userId, `â ØªÙ ØªØ¹Ø¯ÙÙ Ø§ÙÙØ­Ø§Ø¶Ø±Ø© Ø¨ÙØ¬Ø§Ø­!${signature}`);
                userState.delete(userId);
                return;
            }

            // Manage sections
            if (state.step === 'manage_sections') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 4) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ ÙÙ 1 Ø¥ÙÙ 4.${signature}`);
                    return;
                }

                switch (option) {
                    case 1: // Show sections
                        if (sections.size === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ØªÙØ¬Ø¯ Ø´Ø¹Ø¨ ÙØ¶Ø§ÙØ© Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let sectionsList = `ð *ÙØ§Ø¦ÙØ© Ø§ÙØ´Ø¹Ø¨:*\n\n`;
                        let index = 1;
                        for (const [id, name] of sections) {
                            sectionsList += `${index}. ${name}\n`;
                            index++;
                        }

                        await client.sendMessage(userId, sectionsList + signature);
                        userState.delete(userId);
                        break;

                    case 2: // Add section
                        await client.sendMessage(userId, `ð *Ø¥Ø¶Ø§ÙØ© Ø´Ø¹Ø¨Ø©*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§Ø³Ù Ø§ÙØ´Ø¹Ø¨Ø©:${signature}`);
                        state.step = 'add_section';
                        userState.set(userId, state);
                        break;

                    case 3: // Delete section
                        if (sections.size === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ØªÙØ¬Ø¯ Ø´Ø¹Ø¨ ÙØ¶Ø§ÙØ© Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let deleteSectionsList = `ðï¸ *Ø­Ø°Ù Ø´Ø¹Ø¨Ø©*\n\nØ§Ø®ØªØ± Ø§ÙØ´Ø¹Ø¨Ø© Ø§ÙØªÙ ØªØ±ÙØ¯ Ø­Ø°ÙÙØ§:\n\n`;
                        let deleteIndex = 1;
                        for (const [id, name] of sections) {
                            deleteSectionsList += `${deleteIndex}. ${name}\n`;
                            deleteIndex++;
                        }
                        deleteSectionsList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙØ´Ø¹Ø¨Ø© Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;

                        await client.sendMessage(userId, deleteSectionsList);
                        state.step = 'delete_section';
                        userState.set(userId, state);
                        break;

                    case 4: // Edit section
                        if (sections.size === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ØªÙØ¬Ø¯ Ø´Ø¹Ø¨ ÙØ¶Ø§ÙØ© Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let editSectionsList = `âï¸ *ØªØ¹Ø¯ÙÙ Ø´Ø¹Ø¨Ø©*\n\nØ§Ø®ØªØ± Ø§ÙØ´Ø¹Ø¨Ø© Ø§ÙØªÙ ØªØ±ÙØ¯ ØªØ¹Ø¯ÙÙÙØ§:\n\n`;
                        let editIndex = 1;
                        for (const [id, name] of sections) {
                            editSectionsList += `${editIndex}. ${name}\n`;
                            editIndex++;
                        }
                        editSectionsList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙØ´Ø¹Ø¨Ø© Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;

                        await client.sendMessage(userId, editSectionsList);
                        state.step = 'edit_section';
                        userState.set(userId, state);
                        break;
                }
                return;
            }

            // Add section
            if (state.step === 'add_section') {
                const sectionName = content.trim();
                if (!sectionName) {
                    await client.sendMessage(userId, `â ï¸ ÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§Ø³Ù Ø§ÙØ´Ø¹Ø¨Ø©!${signature}`);
                    return;
                }

                const sectionId = Date.now().toString();
                sections.set(sectionId, sectionName);
                saveSections();

                await client.sendMessage(userId, `â ØªÙØª Ø¥Ø¶Ø§ÙØ© Ø§ÙØ´Ø¹Ø¨Ø©: ${sectionName}${signature}`);
                userState.delete(userId);
                return;
            }

            // Delete section
            if (state.step === 'delete_section') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > sections.size) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙØ´Ø¹Ø¨Ø© Ø§ÙØµØ­ÙØ­.${signature}`);
                    return;
                }

                const sectionId = Array.from(sections.keys())[option - 1];
                const sectionName = sections.get(sectionId);
                sections.delete(sectionId);
                saveSections();

                await client.sendMessage(userId, `â ØªÙ Ø­Ø°Ù Ø§ÙØ´Ø¹Ø¨Ø©: ${sectionName}${signature}`);
                userState.delete(userId);
                return;
            }

            // Edit section
            if (state.step === 'edit_section') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > sections.size) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙØ´Ø¹Ø¨Ø© Ø§ÙØµØ­ÙØ­.${signature}`);
                    return;
                }

                const sectionId = Array.from(sections.keys())[option - 1];
                const sectionName = sections.get(sectionId);
                await client.sendMessage(userId, `âï¸ *ØªØ¹Ø¯ÙÙ Ø´Ø¹Ø¨Ø©*\n\nØ§ÙØ§Ø³Ù Ø§ÙØ­Ø§ÙÙ: ${sectionName}\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§ÙØ§Ø³Ù Ø§ÙØ¬Ø¯ÙØ¯:${signature}`);
                state.sectionId = sectionId;
                state.step = 'edit_section_value';
                userState.set(userId, state);
                return;
            }

            // Edit section value
            if (state.step === 'edit_section_value') {
                const newSectionName = content.trim();
                if (!newSectionName) {
                    await client.sendMessage(userId, `â ï¸ ÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§ÙØ§Ø³Ù Ø§ÙØ¬Ø¯ÙØ¯!${signature}`);
                    return;
                }

                sections.set(state.sectionId, newSectionName);
                saveSections();

                await client.sendMessage(userId, `â ØªÙ ØªØ¹Ø¯ÙÙ Ø§Ø³Ù Ø§ÙØ´Ø¹Ø¨Ø© Ø¨ÙØ¬Ø§Ø­!${signature}`);
                userState.delete(userId);
                return;
            }

            // Manage classes
            if (state.step === 'manage_classes') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 4) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ ÙÙ 1 Ø¥ÙÙ 4.${signature}`);
                    return;
                }

                switch (option) {
                    case 1: // Show classes
                        if (classes.size === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ØªÙØ¬Ø¯ ÙØµÙÙ ÙØ¶Ø§ÙØ© Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let classesList = `ð« *ÙØ§Ø¦ÙØ© Ø§ÙÙØµÙÙ:*\n\n`;
                        let index = 1;
                        for (const [id, name] of classes) {
                            classesList += `${index}. ${name}\n`;
                            index++;
                        }

                        await client.sendMessage(userId, classesList + signature);
                        userState.delete(userId);
                        break;

                    case 2: // Add class
                        await client.sendMessage(userId, `ð« *Ø¥Ø¶Ø§ÙØ© ÙØµÙ*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§Ø³Ù Ø§ÙÙØµÙ:${signature}`);
                        state.step = 'add_class';
                        userState.set(userId, state);
                        break;

                    case 3: // Delete class
                        if (classes.size === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ØªÙØ¬Ø¯ ÙØµÙÙ ÙØ¶Ø§ÙØ© Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let deleteClassesList = `ðï¸ *Ø­Ø°Ù ÙØµÙ*\n\nØ§Ø®ØªØ± Ø§ÙÙØµÙ Ø§ÙØ°Ù ØªØ±ÙØ¯ Ø­Ø°ÙÙ:\n\n`;
                        let deleteIndex = 1;
                        for (const [id, name] of classes) {
                            deleteClassesList += `${deleteIndex}. ${name}\n`;
                            deleteIndex++;
                        }
                        deleteClassesList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙÙØµÙ Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;

                        await client.sendMessage(userId, deleteClassesList);
                        state.step = 'delete_class';
                        userState.set(userId, state);
                        break;

                    case 4: // Edit class
                        if (classes.size === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ØªÙØ¬Ø¯ ÙØµÙÙ ÙØ¶Ø§ÙØ© Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let editClassesList = `âï¸ *ØªØ¹Ø¯ÙÙ ÙØµÙ*\n\nØ§Ø®ØªØ± Ø§ÙÙØµÙ Ø§ÙØ°Ù ØªØ±ÙØ¯ ØªØ¹Ø¯ÙÙÙ:\n\n`;
                        let editIndex = 1;
                        for (const [id, name] of classes) {
                            editClassesList += `${editIndex}. ${name}\n`;
                            editIndex++;
                        }
                        editClassesList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙÙØµÙ Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;

                        await client.sendMessage(userId, editClassesList);
                        state.step = 'edit_class';
                        userState.set(userId, state);
                        break;
                }
                return;
            }

            // Add class
            if (state.step === 'add_class') {
                const className = content.trim();
                if (!className) {
                    await client.sendMessage(userId, `â ï¸ ÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§Ø³Ù Ø§ÙÙØµÙ!${signature}`);
                    return;
                }

                const classId = Date.now().toString();
                classes.set(classId, className);
                saveClasses();

                await client.sendMessage(userId, `â ØªÙØª Ø¥Ø¶Ø§ÙØ© Ø§ÙÙØµÙ: ${className}${signature}`);
                userState.delete(userId);
                return;
            }

            // Delete class
            if (state.step === 'delete_class') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > classes.size) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙÙØµÙ Ø§ÙØµØ­ÙØ­.${signature}`);
                    return;
                }

                const classId = Array.from(classes.keys())[option - 1];
                const className = classes.get(classId);
                classes.delete(classId);
                saveClasses();

                await client.sendMessage(userId, `â ØªÙ Ø­Ø°Ù Ø§ÙÙØµÙ: ${className}${signature}`);
                userState.delete(userId);
                return;
            }

            // Edit class
            if (state.step === 'edit_class') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > classes.size) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙÙØµÙ Ø§ÙØµØ­ÙØ­.${signature}`);
                    return;
                }

                const classId = Array.from(classes.keys())[option - 1];
                const className = classes.get(classId);
                await client.sendMessage(userId, `âï¸ *ØªØ¹Ø¯ÙÙ ÙØµÙ*\n\nØ§ÙØ§Ø³Ù Ø§ÙØ­Ø§ÙÙ: ${className}\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§ÙØ§Ø³Ù Ø§ÙØ¬Ø¯ÙØ¯:${signature}`);
                state.classId = classId;
                state.step = 'edit_class_value';
                userState.set(userId, state);
                return;
            }

            // Edit class value
            if (state.step === 'edit_class_value') {
                const newClassName = content.trim();
                if (!newClassName) {
                    await client.sendMessage(userId, `â ï¸ ÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§ÙØ§Ø³Ù Ø§ÙØ¬Ø¯ÙØ¯!${signature}`);
                    return;
                }

                classes.set(state.classId, newClassName);
                saveClasses();

                await client.sendMessage(userId, `â ØªÙ ØªØ¹Ø¯ÙÙ Ø§Ø³Ù Ø§ÙÙØµÙ Ø¨ÙØ¬Ø§Ø­!${signature}`);
                userState.delete(userId);
                return;
            }

            // Manage groups
            if (state.step === 'manage_groups') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 4) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ ÙÙ 1 Ø¥ÙÙ 4.${signature}`);
                    return;
                }

                switch (option) {
                    case 1: // Show groups
                        if (groupsData.size === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ØªÙØ¬Ø¯ Ø£ÙÙØ§Ø¬ ÙØ¶Ø§ÙØ© Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let groupsList = `ð¥ *ÙØ§Ø¦ÙØ© Ø§ÙØ£ÙÙØ§Ø¬:*\n\n`;
                        let index = 1;
                        for (const [id, name] of groupsData) {
                            groupsList += `${index}. ${name}\n`;
                            index++;
                        }

                        await client.sendMessage(userId, groupsList + signature);
                        userState.delete(userId);
                        break;

                    case 2: // Add group
                        await client.sendMessage(userId, `ð¥ *Ø¥Ø¶Ø§ÙØ© ÙÙØ¬*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§Ø³Ù Ø§ÙÙÙØ¬:${signature}`);
                        state.step = 'add_group';
                        userState.set(userId, state);
                        break;

                    case 3: // Delete group
                        if (groupsData.size === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ØªÙØ¬Ø¯ Ø£ÙÙØ§Ø¬ ÙØ¶Ø§ÙØ© Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let deleteGroupsList = `ðï¸ *Ø­Ø°Ù ÙÙØ¬*\n\nØ§Ø®ØªØ± Ø§ÙÙÙØ¬ Ø§ÙØ°Ù ØªØ±ÙØ¯ Ø­Ø°ÙÙ:\n\n`;
                        let deleteIndex = 1;
                        for (const [id, name] of groupsData) {
                            deleteGroupsList += `${deleteIndex}. ${name}\n`;
                            deleteIndex++;
                        }
                        deleteGroupsList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙÙÙØ¬ Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;

                        await client.sendMessage(userId, deleteGroupsList);
                        state.step = 'delete_group';
                        userState.set(userId, state);
                        break;

                    case 4: // Edit group
                        if (groupsData.size === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ØªÙØ¬Ø¯ Ø£ÙÙØ§Ø¬ ÙØ¶Ø§ÙØ© Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let editGroupsList = `âï¸ *ØªØ¹Ø¯ÙÙ ÙÙØ¬*\n\nØ§Ø®ØªØ± Ø§ÙÙÙØ¬ Ø§ÙØ°Ù ØªØ±ÙØ¯ ØªØ¹Ø¯ÙÙÙ:\n\n`;
                        let editIndex = 1;
                        for (const [id, name] of groupsData) {
                            editGroupsList += `${editIndex}. ${name}\n`;
                            editIndex++;
                        }
                        editGroupsList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙÙÙØ¬ Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;

                        await client.sendMessage(userId, editGroupsList);
                        state.step = 'edit_group';
                        userState.set(userId, state);
                        break;
                }
                return;
            }

            // Add group
            if (state.step === 'add_group') {
                const groupName = content.trim();
                if (!groupName) {
                    await client.sendMessage(userId, `â ï¸ ÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§Ø³Ù Ø§ÙÙÙØ¬!${signature}`);
                    return;
                }

                const groupId = Date.now().toString();
                groupsData.set(groupId, groupName);
                saveGroups();

                await client.sendMessage(userId, `â ØªÙØª Ø¥Ø¶Ø§ÙØ© Ø§ÙÙÙØ¬: ${groupName}${signature}`);
                userState.delete(userId);
                return;
            }

            // Delete group
            if (state.step === 'delete_group') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > groupsData.size) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙÙÙØ¬ Ø§ÙØµØ­ÙØ­.${signature}`);
                    return;
                }

                const groupId = Array.from(groupsData.keys())[option - 1];
                const groupName = groupsData.get(groupId);
                groupsData.delete(groupId);
                saveGroups();

                await client.sendMessage(userId, `â ØªÙ Ø­Ø°Ù Ø§ÙÙÙØ¬: ${groupName}${signature}`);
                userState.delete(userId);
                return;
            }

            // Edit group
            if (state.step === 'edit_group') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > groupsData.size) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙÙÙØ¬ Ø§ÙØµØ­ÙØ­.${signature}`);
                    return;
                }

                const groupId = Array.from(groupsData.keys())[option - 1];
                const groupName = groupsData.get(groupId);
                await client.sendMessage(userId, `âï¸ *ØªØ¹Ø¯ÙÙ ÙÙØ¬*\n\nØ§ÙØ§Ø³Ù Ø§ÙØ­Ø§ÙÙ: ${groupName}\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§ÙØ§Ø³Ù Ø§ÙØ¬Ø¯ÙØ¯:${signature}`);
                state.groupId = groupId;
                state.step = 'edit_group_value';
                userState.set(userId, state);
                return;
            }

            // Edit group value
            if (state.step === 'edit_group_value') {
                const newGroupName = content.trim();
                if (!newGroupName) {
                    await client.sendMessage(userId, `â ï¸ ÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§ÙØ§Ø³Ù Ø§ÙØ¬Ø¯ÙØ¯!${signature}`);
                    return;
                }

                groupsData.set(state.groupId, newGroupName);
                saveGroups();

                await client.sendMessage(userId, `â ØªÙ ØªØ¹Ø¯ÙÙ Ø§Ø³Ù Ø§ÙÙÙØ¬ Ø¨ÙØ¬Ø§Ø­!${signature}`);
                userState.delete(userId);
                return;
            }

            // Manage professors
            if (state.step === 'manage_professors') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 4) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ ÙÙ 1 Ø¥ÙÙ 4.${signature}`);
                    return;
                }

                switch (option) {
                    case 1: // Show professors
                        if (professors.size === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ÙÙØ¬Ø¯ Ø£Ø³Ø§ØªØ°Ø© ÙØ¶Ø§ÙÙÙ Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let professorsList = `ð¨âð« *ÙØ§Ø¦ÙØ© Ø§ÙØ£Ø³Ø§ØªØ°Ø©:*\n\n`;
                        let index = 1;
                        for (const [id, name] of professors) {
                            professorsList += `${index}. ${name}\n`;
                            index++;
                        }

                        await client.sendMessage(userId, professorsList + signature);
                        userState.delete(userId);
                        break;

                    case 2: // Add professor
                        await client.sendMessage(userId, `ð¨âð« *Ø¥Ø¶Ø§ÙØ© Ø£Ø³ØªØ§Ø°*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§Ø³Ù Ø§ÙØ£Ø³ØªØ§Ø°:${signature}`);
                        state.step = 'add_professor';
                        userState.set(userId, state);
                        break;

                    case 3: // Delete professor
                        if (professors.size === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ÙÙØ¬Ø¯ Ø£Ø³Ø§ØªØ°Ø© ÙØ¶Ø§ÙÙÙ Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let deleteProfessorsList = `ðï¸ *Ø­Ø°Ù Ø£Ø³ØªØ§Ø°*\n\nØ§Ø®ØªØ± Ø§ÙØ£Ø³ØªØ§Ø° Ø§ÙØ°Ù ØªØ±ÙØ¯ Ø­Ø°ÙÙ:\n\n`;
                        let deleteIndex = 1;
                        for (const [id, name] of professors) {
                            deleteProfessorsList += `${deleteIndex}. ${name}\n`;
                            deleteIndex++;
                        }
                        deleteProfessorsList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙØ£Ø³ØªØ§Ø° Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;

                        await client.sendMessage(userId, deleteProfessorsList);
                        state.step = 'delete_professor';
                        userState.set(userId, state);
                        break;

                    case 4: // Edit professor
                        if (professors.size === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ÙÙØ¬Ø¯ Ø£Ø³Ø§ØªØ°Ø© ÙØ¶Ø§ÙÙÙ Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let editProfessorsList = `âï¸ *ØªØ¹Ø¯ÙÙ Ø£Ø³ØªØ§Ø°*\n\nØ§Ø®ØªØ± Ø§ÙØ£Ø³ØªØ§Ø° Ø§ÙØ°Ù ØªØ±ÙØ¯ ØªØ¹Ø¯ÙÙÙ:\n\n`;
                        let editIndex = 1;
                        for (const [id, name] of professors) {
                            editProfessorsList += `${editIndex}. ${name}\n`;
                            editIndex++;
                        }
                        editProfessorsList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙØ£Ø³ØªØ§Ø° Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;

                        await client.sendMessage(userId, editProfessorsList);
                        state.step = 'edit_professor';
                        userState.set(userId, state);
                        break;
                }
                return;
            }

            // Add professor
            if (state.step === 'add_professor') {
                const professorName = content.trim();
                if (!professorName) {
                    await client.sendMessage(userId, `â ï¸ ÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§Ø³Ù Ø§ÙØ£Ø³ØªØ§Ø°!${signature}`);
                    return;
                }

                const professorId = Date.now().toString();
                professors.set(professorId, professorName);
                saveProfessors();

                await client.sendMessage(userId, `â ØªÙØª Ø¥Ø¶Ø§ÙØ© Ø§ÙØ£Ø³ØªØ§Ø°: ${professorName}${signature}`);
                userState.delete(userId);
                return;
            }

            // Delete professor
            if (state.step === 'delete_professor') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > professors.size) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙØ£Ø³ØªØ§Ø° Ø§ÙØµØ­ÙØ­.${signature}`);
                    return;
                }

                const professorId = Array.from(professors.keys())[option - 1];
                const professorName = professors.get(professorId);
                professors.delete(professorId);
                saveProfessors();

                await client.sendMessage(userId, `â ØªÙ Ø­Ø°Ù Ø§ÙØ£Ø³ØªØ§Ø°: ${professorName}${signature}`);
                userState.delete(userId);
                return;
            }

            // Edit professor
            if (state.step === 'edit_professor') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > professors.size) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙØ£Ø³ØªØ§Ø° Ø§ÙØµØ­ÙØ­.${signature}`);
                    return;
                }

                const professorId = Array.from(professors.keys())[option - 1];
                const professorName = professors.get(professorId);
                await client.sendMessage(userId, `âï¸ *ØªØ¹Ø¯ÙÙ Ø£Ø³ØªØ§Ø°*\n\nØ§ÙØ§Ø³Ù Ø§ÙØ­Ø§ÙÙ: ${professorName}\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§ÙØ§Ø³Ù Ø§ÙØ¬Ø¯ÙØ¯:${signature}`);
                state.professorId = professorId;
                state.step = 'edit_professor_value';
                userState.set(userId, state);
                return;
            }

            // Edit professor value
            if (state.step === 'edit_professor_value') {
                const newProfessorName = content.trim();
                if (!newProfessorName) {
                    await client.sendMessage(userId, `â ï¸ ÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§ÙØ§Ø³Ù Ø§ÙØ¬Ø¯ÙØ¯!${signature}`);
                    return;
                }

                professors.set(state.professorId, newProfessorName);
                saveProfessors();

                await client.sendMessage(userId, `â ØªÙ ØªØ¹Ø¯ÙÙ Ø§Ø³Ù Ø§ÙØ£Ø³ØªØ§Ø° Ø¨ÙØ¬Ø§Ø­!${signature}`);
                userState.delete(userId);
                return;
            }

            // Manage subjects
            if (state.step === 'manage_subjects') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 4) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ ÙÙ 1 Ø¥ÙÙ 4.${signature}`);
                    return;
                }

                switch (option) {
                    case 1: // Show subjects
                        if (subjects.size === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ØªÙØ¬Ø¯ ÙÙØ§Ø¯ ÙØ¶Ø§ÙØ© Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let subjectsList = `ð *ÙØ§Ø¦ÙØ© Ø§ÙÙÙØ§Ø¯:*\n\n`;
                        let index = 1;
                        for (const [id, name] of subjects) {
                            subjectsList += `${index}. ${name}\n`;
                            index++;
                        }

                        await client.sendMessage(userId, subjectsList + signature);
                        userState.delete(userId);
                        break;

                    case 2: // Add subject
                        await client.sendMessage(userId, `ð *Ø¥Ø¶Ø§ÙØ© ÙØ§Ø¯Ø©*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§Ø³Ù Ø§ÙÙØ§Ø¯Ø©:${signature}`);
                        state.step = 'add_subject';
                        userState.set(userId, state);
                        break;

                    case 3: // Delete subject
                        if (subjects.size === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ØªÙØ¬Ø¯ ÙÙØ§Ø¯ ÙØ¶Ø§ÙØ© Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let deleteSubjectsList = `ðï¸ *Ø­Ø°Ù ÙØ§Ø¯Ø©*\n\nØ§Ø®ØªØ± Ø§ÙÙØ§Ø¯Ø© Ø§ÙØªÙ ØªØ±ÙØ¯ Ø­Ø°ÙÙØ§:\n\n`;
                        let deleteIndex = 1;
                        for (const [id, name] of subjects) {
                            deleteSubjectsList += `${deleteIndex}. ${name}\n`;
                            deleteIndex++;
                        }
                        deleteSubjectsList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙÙØ§Ø¯Ø© Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;

                        await client.sendMessage(userId, deleteSubjectsList);
                        state.step = 'delete_subject';
                        userState.set(userId, state);
                        break;

                    case 4: // Edit subject
                        if (subjects.size === 0) {
                            await client.sendMessage(userId, `â ï¸ ÙØ§ ØªÙØ¬Ø¯ ÙÙØ§Ø¯ ÙØ¶Ø§ÙØ© Ø¨Ø¹Ø¯!${signature}`);
                            userState.delete(userId);
                            return;
                        }

                        let editSubjectsList = `âï¸ *ØªØ¹Ø¯ÙÙ ÙØ§Ø¯Ø©*\n\nØ§Ø®ØªØ± Ø§ÙÙØ§Ø¯Ø© Ø§ÙØªÙ ØªØ±ÙØ¯ ØªØ¹Ø¯ÙÙÙØ§:\n\n`;
                        let editIndex = 1;
                        for (const [id, name] of subjects) {
                            editSubjectsList += `${editIndex}. ${name}\n`;
                            editIndex++;
                        }
                        editSubjectsList += `\nð¡ Ø£Ø±Ø³Ù Ø±ÙÙ Ø§ÙÙØ§Ø¯Ø© Ø£Ù *Ø¥ÙØºØ§Ø¡* ÙÙØ®Ø±ÙØ¬${signature}`;

                        await client.sendMessage(userId, editSubjectsList);
                        state.step = 'edit_subject';
                        userState.set(userId, state);
                        break;
                }
                return;
            }

            // Add subject
            if (state.step === 'add_subject') {
                const subjectName = content.trim();
                if (!subjectName) {
                    await client.sendMessage(userId, `â ï¸ ÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§Ø³Ù Ø§ÙÙØ§Ø¯Ø©!${signature}`);
                    return;
                }

                const subjectId = Date.now().toString();
                subjects.set(subjectId, subjectName);
                saveSubjects();

                await client.sendMessage(userId, `â ØªÙØª Ø¥Ø¶Ø§ÙØ© Ø§ÙÙØ§Ø¯Ø©: ${subjectName}${signature}`);
                userState.delete(userId);
                return;
            }

            // Delete subject
            if (state.step === 'delete_subject') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > subjects.size) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙÙØ§Ø¯Ø© Ø§ÙØµØ­ÙØ­.${signature}`);
                    return;
                }

                const subjectId = Array.from(subjects.keys())[option - 1];
                const subjectName = subjects.get(subjectId);
                subjects.delete(subjectId);
                saveSubjects();

                await client.sendMessage(userId, `â ØªÙ Ø­Ø°Ù Ø§ÙÙØ§Ø¯Ø©: ${subjectName}${signature}`);
                userState.delete(userId);
                return;
            }

            // Edit subject
            if (state.step === 'edit_subject') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > subjects.size) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ Ø§ÙÙØ§Ø¯Ø© Ø§ÙØµØ­ÙØ­.${signature}`);
                    return;
                }

                const subjectId = Array.from(subjects.keys())[option - 1];
                const subjectName = subjects.get(subjectId);
                await client.sendMessage(userId, `âï¸ *ØªØ¹Ø¯ÙÙ ÙØ§Ø¯Ø©*\n\nØ§ÙØ§Ø³Ù Ø§ÙØ­Ø§ÙÙ: ${subjectName}\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§ÙØ§Ø³Ù Ø§ÙØ¬Ø¯ÙØ¯:${signature}`);
                state.subjectId = subjectId;
                state.step = 'edit_subject_value';
                userState.set(userId, state);
                return;
            }

            // Edit subject value
            if (state.step === 'edit_subject_value') {
                const newSubjectName = content.trim();
                if (!newSubjectName) {
                    await client.sendMessage(userId, `â ï¸ ÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§ÙØ§Ø³Ù Ø§ÙØ¬Ø¯ÙØ¯!${signature}`);
                    return;
                }

                subjects.set(state.subjectId, newSubjectName);
                saveSubjects();

                await client.sendMessage(userId, `â ØªÙ ØªØ¹Ø¯ÙÙ Ø§Ø³Ù Ø§ÙÙØ§Ø¯Ø© Ø¨ÙØ¬Ø§Ø­!${signature}`);
                userState.delete(userId);
                return;
            }

            // Edit commands
            if (state.step === 'edit_commands') {
                const option = parseInt(content);
                if (isNaN(option) || option < 1 || option > 9) {
                    await client.sendMessage(userId, `â ï¸ Ø®ÙØ§Ø± ØºÙØ± ØµØ­ÙØ­! ÙØ±Ø¬Ù Ø§Ø®ØªÙØ§Ø± Ø±ÙÙ ÙÙ 1 Ø¥ÙÙ 9.${signature}`);
                    return;
                }

                const commandNames = {
                    1: '!ask',
                    2: '!analyze',
                    3: '!generate',
                    4: '!Ø¬Ø¯ÙÙ_Ø§ÙÙØ­Ø§Ø¶Ø±Ø§Øª',
                    5: '!ØªØ«Ø¨ÙØª',
                    6: '!Ø§Ø¶Ø§ÙØ©_pdf',
                    7: '!ØªØ­ÙÙÙ',
                    8: '!Ø¥Ø¯Ø§Ø±Ø©',
                    9: '!commands'
                };

                await client.sendMessage(userId, `âï¸ *ØªØ¹Ø¯ÙÙ Ø§ÙØ£ÙØ±: ${commandNames[option]}*\n\nÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§ÙÙØµÙ Ø§ÙØ¬Ø¯ÙØ¯ ÙÙØ£ÙØ±:${signature}`);
                state.commandName = commandNames[option];
                state.step = 'edit_command_description';
                userState.set(userId, state);
                return;
            }

            // Edit command description
            if (state.step === 'edit_command_description') {
                const newDescription = content.trim();
                if (!newDescription) {
                    await client.sendMessage(userId, `â ï¸ ÙØ±Ø¬Ù Ø¥Ø±Ø³Ø§Ù Ø§ÙÙØµÙ Ø§ÙØ¬Ø¯ÙØ¯!${signature}`);
                    return;
                }

                // Here you would update the command description in your system
                // For now, we'll just confirm the change
                await client.sendMessage(userId, `â ØªÙ ØªØ¹Ø¯ÙÙ ÙØµÙ Ø§ÙØ£ÙØ±: ${state.commandName}\n\nØ§ÙÙØµÙ Ø§ÙØ¬Ø¯ÙØ¯: ${newDescription}${signature}`);
                userState.delete(userId);
                return;
            }
        }
    } catch (error) {
        console.error('[â] Error in message handler:', error);
    }
});

// Ø­ÙØ¸ Ø§ÙØ¬ÙØ³Ø©
client.on('auth_failure', () => {
    console.log('[â] Authentication failed');
});

client.on('disconnected', () => {
    console.log('[â] Client disconnected');
});

// Ø¨Ø¯Ø¡ Ø§ÙØ¨ÙØª
client.initialize().catch(err => {
    console.error('[â] Error initializing client:', err);
});