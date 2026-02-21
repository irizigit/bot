const puppeteer = require('puppeteer');

async function getStudentInfo(apogee, cin, birthDate) {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });

    const page = await browser.newPage();
    // تعيين User Agent ليبدو المتصفح كأنه متصفح حقيقي
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        await page.goto('https://web.flshbm.ma/', { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        // الانتظار حتى تظهر خانة الأبوجي في الصفحة قبل المحاولة
        await page.waitForSelector('input[name="apogee"]', { timeout: 10000 });

        // إدخال البيانات بدقة
        await page.type('input[name="apogee"]', apogee, { delay: 50 });
        await page.type('input[name="cin"]', cin, { delay: 50 });
        await page.type('input[name="date_naissance"]', birthDate, { delay: 50 });

        // النقر على زر الإرسال والانتظار
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
        ]);

        const resultText = await page.evaluate(() => {
            // محاولة جلب المعلومات من الكارط أو الجدول
            const card = document.querySelector('.card-body') || document.querySelector('main');
            return card ? card.innerText.trim() : null;
        });

        await browser.close();
        
        if (!resultText || resultText.includes("خطأ")) {
            return "❌ المعلومات المدخلة غير صحيحة أو الموقع لا يستجيب حالياً.";
        }

        return `✅ *نتائج الفحص:* \n\n${resultText}`;

    } catch (error) {
        console.error('Scraping Error:', error.message);
        await browser.close();
        // إرجاع رسالة خطأ واضحة للمستخدم
        return `❌ حدث خطأ أثناء الاتصال بالموقع: ${error.message}`;
    }
}

module.exports = { getStudentInfo };
