const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// ==========================================
// 1. دالة الدخول للموقع وجلب السكرين شوت
// ==========================================
async function getStudentInfo(apogee, cin, birthDate) {
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1024 }); 
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.setRequestInterception(true);
    page.on('request', (request) => {
        if (['image', 'media', 'font'].includes(request.resourceType())) {
            request.abort();
        } else {
            request.continue(); 
        }
    });

    try {
        await page.goto('https://web.flshbm.ma/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('#apogee', { timeout: 20000 });

        await page.type('#apogee', apogee, { delay: 10 });
        await page.type('#cin', cin, { delay: 10 });
        await page.type('#date_naissance', birthDate, { delay: 10 });

        await Promise.all([
            page.click('button'),
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
        ]);

        await new Promise(r => setTimeout(r, 2000));

        const isError = await page.evaluate(() => {
            return document.body.innerText.includes('خطأ') || document.body.innerText.includes('incorrectes');
        });

        if (isError) {
            await browser.close();
            return { success: false, text: "❌ المعلومات المدخلة غير صحيحة." };
        }

        const clicked = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('a, button, div.card'));
            const resBtn = elements.find(el => el.innerText && el.innerText.includes('Résultats'));
            if (resBtn) {
                resBtn.click();
                return true;
            }
            return false;
        });

        if (!clicked) {
            await browser.close();
            return { success: false, text: "❌ تم الدخول بنجاح، لكن لم أتمكن من العثور على قسم 'النتائج'." };
        }

        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => console.log("AJAX Load"));
        await new Promise(r => setTimeout(r, 4000)); 

        const screenshotPath = path.join(__dirname, `results_${apogee}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        await browser.close();
        return { success: true, path: screenshotPath };

    } catch (error) {
        console.error('Scraping Error:', error.message);
        await browser.close();
        return { success: false, text: `❌ حدث خطأ أثناء جلب النتائج: ${error.message}` };
    }
}

// ==========================================
// 2. دالة التعامل مع رسائل الواتساب
// ==========================================
async function handleStudentCommand(content, message, sendReply, MessageMedia, signature) {
    const args = content.split(' ').slice(1);
    
    if (args.length < 3) {
        return sendReply(`⚠️ *طريقة الاستخدام:* \n!فحص [رقم_الأبوجي] [CIN] [تاريخ_الميلاد]\n\n💡 مثال:\n!فحص 21004455 AB123456 2005-12-14${signature}`);
    }

    let apogee = "", cin = "", birth = "";

    args.forEach(arg => {
        if (arg.includes('-') || arg.includes('/')) {
            birth = arg;
        } else if (/^[a-zA-Z]/.test(arg)) {
            cin = arg.toUpperCase();
        } else if (/^\d+$/.test(arg)) {
            apogee = arg;
        }
    });

    if (!apogee || !cin || !birth) {
         return sendReply(`⚠️ *تأكد من إدخال المعلومات بشكل صحيح:* \n- رقم الأبوجي (أرقام فقط)\n- رقم البطاقة الوطنية (حروف وأرقام)\n- تاريخ الازدياد (YYYY-MM-DD)${signature}`);
    }
    
    await message.react('⏳');
    await sendReply('⏳ *جاري الدخول للحساب وجلب النقط...* المرجو الانتظار.');

    try {
        const result = await getStudentInfo(apogee, cin, birth);
        
        if (result.success && result.path) {
            const media = MessageMedia.fromFilePath(result.path);
            await sendReply(media, { caption: `✅ *تفضل، هاهي النقط والنتائج ديالك!* 📊${signature}` });
            await message.react('✅');
            
            if (fs.existsSync(result.path)) {
                fs.unlinkSync(result.path);
            }
        } else {
            await sendReply(result.text + signature);
            await message.react('❌');
        }
    } catch (err) {
        await sendReply("❌ وقع مشكل تقني داخلي أثناء معالجة الطلب." + signature);
        await message.react('❌');
    }
}

// تصدير الدالة باش نقدرو نخدمو بيها فملفات أخرى
module.exports = { handleStudentCommand };
