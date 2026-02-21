const puppeteer = require('puppeteer');
const path = require('path');

async function getStudentInfo(apogee, cin, birthDate) {
    const browser = await puppeteer.launch({
        headless: "new", // طريقة أفضل للتشغيل
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled' // باش ما يعيقش بيه الموقع أنه روبوت
        ]
    });

    const page = await browser.newPage();
    // نعطيو للبوت هوية متصفح حقيقي (Google Chrome ديال بصح)
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    try {
        await page.goto('https://web.flshbm.ma/', { waitUntil: 'networkidle2', timeout: 45000 });

        // نتسناو 3 ثواني إضافية باش الموقع ياخد وقتو ويحمل الخانات
        await new Promise(r => setTimeout(r, 3000));

        // محاولة إيجاد خانة الأبوجي
        await page.waitForSelector('input[name="apogee"]', { timeout: 15000 });

        // إدخال البيانات ببطء (باش يبان بحال إنسان كيكتب)
        await page.type('input[name="apogee"]', apogee, { delay: 100 });
        await page.type('input[name="cin"]', cin, { delay: 100 });
        await page.type('input[name="date_naissance"]', birthDate, { delay: 100 });

        // النقر والانتظار
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }),
        ]);

        const resultText = await page.evaluate(() => {
            const card = document.querySelector('.card-body') || document.querySelector('main') || document.body;
            return card ? card.innerText.trim() : null;
        });

        await browser.close();
        
        if (!resultText || resultText.includes("خطأ")) {
            return { success: false, text: "❌ المعلومات المدخلة غير صحيحة أو السيرفر لا يستجيب." };
        }

        return { success: true, text: `✅ *نتائج الفحص:* \n\n${resultText}` };

    } catch (error) {
        console.error('Scraping Error:', error.message);
        
        // أخد صورة (Screenshot) للمشكل باش تفهم علاش ما لقاش الخانة
        const errorImgPath = path.join(__dirname, 'error_flshbm.png');
        try {
            await page.screenshot({ path: errorImgPath, fullPage: true });
        } catch(e) { console.log("تعذر أخذ صورة"); }

        await browser.close();
        
        return { 
            success: false, 
            text: `❌ حدث خطأ أثناء الاتصال بالموقع.\nالسبب: ${error.message}\n\n📸 *قمت بالتقاط صورة للموقع حالياً لفهم المشكلة.*`,
            errorImage: errorImgPath
        };
    }
}

module.exports = { getStudentInfo };
