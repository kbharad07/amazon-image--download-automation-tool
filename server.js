const express = require('express');
const multer = require('multer');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ExifTool } = require("exiftool-vendored");

const app = express();
const upload = multer({ dest: 'uploads/' });
const exiftool = new ExifTool(); // Create once globally

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.post('/download', upload.single('csvFile'), async (req, res) => {
  let asins = [];

  try {

    // Read CSV
    if (req.file) {
      const fileContent = fs.readFileSync(req.file.path, 'utf-8');
      asins = fileContent
        .split('\n')
        .map(a => a.trim())
        .filter(a => a);
    }

    // Read manual ASINs
    if (req.body.asins) {
      const manualAsins = req.body.asins
        .split(/[\n,]+/)
        .map(a => a.trim())
        .filter(a => a);
      asins = asins.concat(manualAsins);
    }

    if (!asins.length) {
      return res.send("No ASINs provided.");
    }

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    for (const asin of asins) {
      try {
        console.log("Processing:", asin);

        const productUrl = `https://www.amazon.in/dp/${asin}`;
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

        const folder = path.join(__dirname, asin);
        if (!fs.existsSync(folder)) fs.mkdirSync(folder);

        let counter = 1;

        for (const url of imageData) {
          try {
            const cleanUrl = url.split('._')[0] + '.jpg';
            const fileName = path.join(folder, `${asin}_${counter}.jpg`);

            const response = await page.request.get(cleanUrl);
            const buffer = await response.body();
            fs.writeFileSync(fileName, buffer);

            // Write Metadata Safely
            try {
              await exiftool.write(fileName, {
                Title: productTitle,
                Subject: productTitle,
                Comment: productTitle,
                Author: productTitle,
                Copyright: productTitle,
                Keywords: [productTitle],
                Rating: 5
              }, ["-overwrite_original"]);
            } catch (metaErr) {
              console.log("Metadata error:", metaErr.message);
            }

            counter++;
          } catch (imgErr) {
            console.log("Image download error:", imgErr.message);
          }
        }

      } catch (asinErr) {
        console.log(`Error with ${asin}:`, asinErr.message);
      }
    }

    await browser.close();

    res.send("All ASINs processed successfully.");

  } catch (err) {
    console.log("Server error:", err.message);
    res.status(500).send("Something went wrong.");
  }
});

// Graceful shutdown (VERY IMPORTANT)
process.on("SIGINT", async () => {
  console.log("Shutting down server...");
  await exiftool.end();
  process.exit();
});

app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});