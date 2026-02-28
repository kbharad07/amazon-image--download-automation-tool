const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ExifTool } = require("exiftool-vendored");

const exiftool = new ExifTool();

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const asins = fs.readFileSync('asins.csv', 'utf-8')
    .split('\n')
    .map(a => a.trim())
    .filter(a => a.length > 0);

  for (const asin of asins) {
    try {
      const productUrl = `https://www.amazon.in/dp/${asin}`;
      console.log(`Processing ASIN: ${asin}`);

      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);

      const productTitle = await page.evaluate(() => {
        const titleElement = document.querySelector('#productTitle');
        return titleElement ? titleElement.innerText.trim() : 'Unknown Title';
      });

      const imageData = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script'));
        let images = [];

        for (const script of scripts) {
          const text = script.textContent;
          if (text && text.includes('ImageBlockATF')) {
            const matches = text.match(/"hiRes":"(https:[^"]+)"/g);
            if (matches) {
              matches.forEach(match => {
                const url = match.split('"')[3];
                images.push(url);
              });
            }
          }
        }

        return [...new Set(images)];
      });

      if (!imageData.length) {
        console.log(`No images found for ${asin}`);
        continue;
      }

      const folder = path.join(__dirname, asin);
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder);
      }

      let counter = 1;

      for (const url of imageData) {
        const cleanUrl = url.split('._')[0] + '.jpg';
        const fileName = path.join(folder, `${asin}_${counter}.jpg`);

        try {
          const response = await page.request.get(cleanUrl);
          const buffer = await response.body();
          fs.writeFileSync(fileName, buffer);

          await exiftool.write(fileName, {
            Title: productTitle,
            Subject: productTitle,
            Comment: productTitle,
            Author: productTitle,
            Copyright: productTitle,
            Keywords: [productTitle],
            XPTitle: productTitle,
            XPSubject: productTitle,
            XPComment: productTitle,
            XPAuthor: productTitle,
            Rating: 5
         },
      ["-overwrite_original"]
    );

          console.log(`Downloaded + Tagged: ${fileName}`);
          counter++;
        } catch (err) {
          console.log(`Failed image for ${asin}`, err.message);
        }
      }

      console.log(`Completed ASIN: ${asin}`);
      await page.waitForTimeout(2000);

    } catch (err) {
      console.log(`Error processing ${asin}:`, err.message);
    }
  }

  await browser.close();
  await exiftool.end();
  console.log("All ASINs processed with full metadata.");
})();