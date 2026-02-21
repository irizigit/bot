const puppeteer = require('puppeteer');

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
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        // الدخول للموقع
        await page.goto('https://web.flshbm.ma/', { waitUntil: 'networkidle2', timeout: 45000 });
        
        // نتسناو 6 ثواني باش نتأكدو أن كلشي تحمل
        await new Promise(r => setTimeout(r, 6000));

        // فحص الصفحة وجلب جميع الخانات المتوفرة
        const pageInfo = await page.evaluate(() => {
            const inputs = document.querySelectorAll('input');
            let info = `عدد الخانات (Inputs) اللي لقيت فالموقع: ${inputs.length}\n\n`;
            
            inputs.forEach((inp, index) => {
                info += `[${index + 1}] Type: "${inp.type}" | Name: "${inp.name}" | ID: "${inp.id}" | Placeholder: "${inp.placeholder}"\n`;
            });
            
            // فحص واش كاين شي Iframe (إطار داخلي)
            const iframes = document.querySelectorAll('iframe');
            info += `\nعدد الإطارات (iframes): ${iframes.length}`;
            
            // فحص الأزرار
            const buttons = document.querySelectorAll('button');
            info += `\nعدد الأزرار (Buttons): ${buttons.length}`;

            return info;
        });

        await browser.close();
        return `🔍 *تقرير فحص الموقع:*\n\n${pageInfo}`;

    } catch (error) {
        console.error('Scraping Error:', error.message);
        await browser.close();
        return `❌ حدث خطأ أثناء الاتصال: ${error.message}`;
    }
}

module.exports = { getStudentInfo };
