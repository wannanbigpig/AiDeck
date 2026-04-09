  const https = require('https');
  https.get('https://u.tools/docs/developer/api.html', (resp) => {
    let data = '';
    resp.on('data', (chunk) => { data += chunk; });
    resp.on('end', () => {
      const cheerio = require('cheerio');
      const $ = cheerio.load(data);
      console.log($('body').text().match(/.{0,50}setSubInput.{0,200}/g));
    });
  }).on("error", (err) => {
    console.log("Error: " + err.message);
  });
