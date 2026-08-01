const express = require('express');
const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const collectBlock = require('mineflayer-collectblock');
const { OpenAI } = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

let bot = null;
let logs = [];

// تنظیمات هوش مصنوعی
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "test";
const openai = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const systemPrompt = `تو یک دستیار هوشمند داخل بازی ماینکرفت به اسم Helper هستی.
وظیفه تو این است که درخواست‌های کاربر را بخوانی و دقیقاً به دستورات ماینکرفت (Command) تبدیل کنی.
قوانین:
1. فقط و فقط دستورات ماینکرفت را برگردان، هیچ متن اضافه‌ای نگو.
2. هر دستور باید در یک خط جداگانه باشد و با علامت / شروع شود.
3. برای دادن آیتم از /give، برای کشتن پلیر از /kill، و برای ساختن خانه از /fill استفاده کن.`;

function addLog(message) {
  const time = new Date().toLocaleTimeString();
  logs.push(`[${time}] ${message}`);
  if (logs.length > 50) logs.shift(); // فقط 50 لاگ آخر نگه داشته شود
}

// ساخت ربات
function startBot() {
  if (bot) return "ربات از قبل روشن است!";
  
  addLog("در حال تلاش برای ورود به سرور...");
  bot = mineflayer.createBot({
    host: "survival_ba_hame.aternos.me",
    port: 55328,
    username: "Helper",
    version: false
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlock);

  bot.on('login', () => {
    addLog("✅ ربات با موفقیت وارد سرور شد!");
    setTimeout(() => bot.chat("سلام! من Helper هستم. از وب‌سایت یا کتاب به من دستور بدهید."), 2000);
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    addLog(`${username}: ${message}`);
  });

  // خواندن کتاب روی زمین
  setInterval(async () => {
    if (!bot || !bot.entity) return;
    const droppedItems = Object.values(bot.entities).filter(e => 
      e.name === 'item' && e.metadata && e.metadata[8] && e.metadata[8].name && e.metadata[8].name.includes('book')
    );

    for (const itemEntity of droppedItems) {
      if (bot.entity.position.distanceTo(itemEntity.position) < 4) {
        try {
          await bot.collectBlock.collect(itemEntity);
          const book = bot.inventory.items().find(item => item.name.includes('book'));
          if (book) await processBook(book);
        } catch(e) {}
        return;
      }
    }
  }, 2000);

  bot.on('error', (err) => addLog(`❌ ارور: ${err.message}`));
  bot.on('end', () => {
    addLog("⚠️ ربات از سرور خارج شد.");
    bot = null;
  });
}

function stopBot() {
  if (!bot) return "ربات روشن نیست!";
  bot.quit();
  bot = null;
  addLog("🛑 ربات توسط ادمین خاموش شد.");
  return "ربات خاموش شد.";
}

// پردازش کتاب یا دستور مستقیم با هوش مصنوعی
async function processAICommand(text) {
  try {
    const response = await openai.chat.completions.create({
      model: "openai/gpt-3.5-turbo", // اگر ارور داد به google/gemini-flash-1.5 تغییر دهید
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
      ],
      temperature: 0.2,
    });

    const aiReply = response.choices[0].message.content.trim();
    const commands = aiReply.split('\n').filter(line => line.trim().startsWith('/'));
    
    if (commands.length === 0) {
      bot.chat("متوجه نشدم چی گفتی!");
    } else {
      for (const cmd of commands) {
        bot.chat(cmd);
        await new Promise(r => setTimeout(r, 500));
      }
      bot.chat("✅ کار تموم شد!");
    }
  } catch (err) {
    addLog(`ارور هوش مصنوعی: ${err.message}`);
    bot.chat("ارور در ارتباط با هوش مصنوعی!");
  }
}

async function processBook(bookItem) {
  bot.chat("📚 کتاب رو خوندم، دارم فکر می‌کنم...");
  let text = "";
  const nbt = bookItem.nbt;
  if (nbt && nbt.value && nbt.value.pages) {
    const pages = nbt.value.pages.value.value || nbt.value.pages.value;
    pages.forEach(page => {
      try { text += JSON.parse(page).text + " "; } 
      catch { text += page + " "; }
    });
  }
  if (text.trim()) await processAICommand(text);
  await bot.tossStack(bookItem);
}

// مسیرهای وب‌سرور
app.post('/start', (req, res) => { startBot(); res.redirect('/'); });
app.post('/stop', (req, res) => { stopBot(); res.redirect('/'); });
app.post('/command', (req, res) => {
  const cmd = req.body.command;
  if (bot && cmd) { bot.chat(cmd); addLog(`ادمین دستور زد: ${cmd}`); }
  res.redirect('/');
});
app.post('/ask-ai', async (req, res) => {
  const text = req.body.ask;
  if (bot && text) { await processAICommand(text); }
  res.redirect('/');
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/logs', (req, res) => {
  res.json({ status: bot ? "ONLINE" : "OFFLINE", logs: logs });
});

app.listen(PORT, () => {
  console.log(`Web panel running on port ${PORT}`);
});
