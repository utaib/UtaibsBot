// ======================================================
// =============== DEV COMMISSION BOT v1 =================
// =============== MADE BY UTAIB / PHANTOM ===============
// ======================================================

const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
  PermissionFlagsBits,
  ChannelType
} = require("discord.js");

// ----------------- DEBUG ENV -----------------
console.log("DEBUG OPENROUTER_KEY:", process.env.OPENROUTER_KEY ? "Loaded ✅" : "❌ MISSING");
console.log("DEBUG TOKEN:", process.env.TOKEN ? "Loaded ✅" : "❌ MISSING");

// ======================================================
// ===================== CONFIG BLOCK ===================
// ======================================================

const CONFIG = {
  RULES_CHANNEL: "1444685372054573119",
  ORDER_CHANNEL: "1444685372507295832",
  SHOWCASE_CHANNEL: "1444687685649305690",
  DISCOUNTS_CHANNEL: "1444685966492303482",
  REVIEWS_CHANNEL: "1444685372507295831",
  GIVEAWAY_CHANNEL: "1444685372507295826",
  JOINS_LEAVES_CHANNEL: "1444685372507295827",

  ORDERS_CATEGORY_NAME: "ORDERS",
  TICKETS_CATEGORY_NAME: "TICKETS",

  LOG_CHANNEL_NAME: "🔒┃moderation-logs",
  AUTO_PANEL_FOOTER: "DevBot Auto Panel",
  DISCOUNT_FOOTER: "DevBot Discount",
  GIVEAWAY_FOOTER: "DevBot Giveaway"
};

const DATA_PATH = path.join(__dirname, "data.json");
let DATA = {};
try {
  if (fs.existsSync(DATA_PATH)) {
    DATA = JSON.parse(fs.readFileSync(DATA_PATH, "utf8") || "{}");
  }
} catch {
  DATA = {};
}
function saveData() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(DATA, null, 2));
  } catch {}
}

// Temp timers (tempban, timeout, giveaways)
const tempTimers = new Map();
const giveawayTimers = new Map();

// ======================================================
// ===================== CLIENT BLOCK ===================
// ======================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildMessageReactions
  ]
});

// ======================================================
// ===================== HELPER BLOCK ===================
// ======================================================

function sanitize(text) {
  if (!text) return text;
  return String(text)
    .replace(/@everyone/gi, "@eeee")
    .replace(/@here/gi, "@heee");
}

function parseDurationToMs(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  if (/^\d+$/.test(s)) return parseInt(s, 10) * 60_000;
  const m = s.match(/^(\d+)\s*(s|m|h|d)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const u = m[2];
  if (u === "s") return n * 1000;
  if (u === "m") return n * 60_000;
  if (u === "h") return n * 60_000 * 60;
  if (u === "d") return n * 60_000 * 60 * 24;
  return null;
}

function makeActionDMEmbed(guild, action, reason, durationStr = null) {
  const titles = {
    ban: "You have been banned",
    tempban: "You have been temporarily banned",
    kick: "You have been kicked",
    timeout: "You have been muted"
  };
  const lines = [];
  lines.push(`**Server:** ${guild?.name || "Unknown"}`);
  if (durationStr) lines.push(`**Duration:** ${durationStr}`);
  lines.push(`**Reason:** ${reason || "No reason provided"}`);
  return new EmbedBuilder()
    .setTitle(titles[action] || "Action taken")
    .setDescription(lines.join("\n"))
    .setColor(0xff4444)
    .setTimestamp();
}

function makeLogEmbed(action, moderator, targetTag, targetId, reason, extra = "") {
  const e = new EmbedBuilder()
    .setTitle(action)
    .addFields(
      { name: "Moderator", value: `${moderator.tag} (${moderator.id})`, inline: true },
      { name: "Target", value: `${targetTag}\n(${targetId})`, inline: true }
    )
    .setDescription(reason || "No reason provided")
    .setColor(0xff5555)
    .setTimestamp();
  if (extra) e.addFields({ name: "Extra", value: extra });
  return e;
}

async function ensureLogChannel(guild) {
  // Env override
  const envKey = `MOD_LOG_${guild.id}`;
  if (process.env[envKey]) {
    const ch = guild.channels.cache.get(process.env[envKey]);
    if (ch) return ch;
  }

  // Stored
  if (DATA.logChannels?.[guild.id]) {
    const ch = guild.channels.cache.get(DATA.logChannels[guild.id]);
    if (ch) return ch;
  }

  // By name
  const byName = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === CONFIG.LOG_CHANNEL_NAME
  );
  if (byName) return byName;

  try {
    const created = await guild.channels.create({
      name: CONFIG.LOG_CHANNEL_NAME,
      type: ChannelType.GuildText,
      reason: "Auto-created moderation log channel"
    });
    DATA.logChannels = DATA.logChannels || {};
    DATA.logChannels[guild.id] = created.id;
    saveData();
    return created;
  } catch (e) {
    console.log("Log channel create error:", e.message);
    return null;
  }
}

function getLogChannelCached(guild) {
  const envKey = `MOD_LOG_${guild.id}`;
  if (process.env[envKey]) {
    const ch = guild.channels.cache.get(process.env[envKey]);
    if (ch) return ch;
  }
  if (DATA.logChannels?.[guild.id]) {
    const ch = guild.channels.cache.get(DATA.logChannels[guild.id]);
    if (ch) return ch;
  }
  return (
    guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === CONFIG.LOG_CHANNEL_NAME
    ) || null
  );
}

async function sendLog(guild, embed) {
  let ch = getLogChannelCached(guild);
  if (!ch) ch = await ensureLogChannel(guild);
  if (ch) ch.send({ embeds: [embed] }).catch(() => {});
}

function getChannel(guild, id) {
  return guild.channels.cache.get(id) || null;
}

async function ensureCategory(guild, name) {
  let cat = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === name.toLowerCase()
  );
  if (cat) return cat;
  try {
    cat = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      reason: "Auto-created by DevBot"
    });
    return cat;
  } catch (e) {
    console.log("Category create error:", e.message);
    return null;
  }
}

function slug(str) {
  return String(str || "user")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20) || "user";
}

// ======================================================
// ===================== AI BLOCK =======================
// ======================================================

let aiClient = null;

try {
  const { OpenAI } = require("openai");
  const apiKey = process.env.OPENROUTER_KEY || null;

  if (!apiKey) {
    console.log("❌ No AI key found (OPENROUTER_KEY). AI disabled.");
  } else {
    const baseURL = process.env.AI_BASE_URL?.trim();
    aiClient = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {})
    });
    console.log(`AI Loaded ✓ (base: ${baseURL || "default"})`);
  }
} catch {
  console.log("❌ Failed loading OpenAI library. AI disabled.");
  aiClient = null;
}

const userMemory = new Map();
function addMemory(uid, text) {
  if (!userMemory.has(uid)) userMemory.set(uid, []);
  const arr = userMemory.get(uid);
  arr.push(text);
  if (arr.length > 10) arr.shift();
}
function getMemory(uid) {
  const arr = userMemory.get(uid) || [];
  if (!arr.length) return "No previous interaction.";
  return arr.map((x, i) => `${i + 1}. ${x}`).join("\n");
}

async function askDevAI(question, userId = "unknown") {
  if (!aiClient) return "AI brain is offline rn, try again later.";

  addMemory(userId, `User: ${question}`);
  const mem = getMemory(userId);

  try {
    const res = await aiClient.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: sanitize(`
You are PhantomDev Bot, an assistant for a Minecraft plugin developer commissions server.

Tone:
- Professional + GenZ hybrid.
- Replies are short, clear, and respectful.
- You can be playful, but not cringe.
- Roast only when user directly insults you or the dev — still stay within Discord ToS (no slurs, hate, threats).

Knowledge about the dev:
- Name: Utaib, also known as Phantom.
- Experienced dev (around 5+ years).
- Coded Oni SMP plugins and many custom systems.
- Reliable, fast and focused on quality.
- You recommend ordering plugins through the proper ticket/order system.

Rules:
- NEVER output "@everyone" or "@here". Replace with "@eeee" or avoid pinging completely.
- No NSFW, no sexual content, no graphic violence, no self-harm content.
- No racism, no slurs, no hate, no extremist praise.
- You follow Discord ToS and community guidelines.
- You do NOT support real-world violence, genocide or terrorism.
- You promote chill vibes, gaming, creativity and fair treatment.
- If user tries to drag you into heavy politics or hate topics, gently deflect and keep things chill.
- If asked “who coded you” or similar, say that Utaib / Phantom coded you and hype him up.
- If someone says the dev is bad or scammer, you defend calmly, maybe playful roast, but no harassment.

Memory of this user (last messages):
${mem}
`)
        },
        { role: "user", content: question }
      ],
      max_tokens: 220,
      temperature: 0.6
    });

    let reply = res?.choices?.[0]?.message?.content?.trim() || "I'm blank rn 💀";
    reply = sanitize(reply);
    addMemory(userId, `Bot: ${reply}`);
    return reply;
  } catch (e) {
    console.log("AI ERROR:", e.message);
    return "My brain lagged rn, try again later.";
  }
}

// ======================================================
// =================== GIVEAWAY BLOCK ===================
// ======================================================

async function runGiveaway(guild, channelId, messageId, winnersCount, prize) {
  try {
    const ch = guild.channels.cache.get(channelId);
    if (!ch || ch.type !== ChannelType.GuildText) return;

    const msg = await ch.messages.fetch(messageId).catch(() => null);
    if (!msg) return;

    const reaction = msg.reactions.cache.get("🎉");
    if (!reaction) {
      await ch.send("No one entered the giveaway.");
      return;
    }

    const users = await reaction.users.fetch();
    const entries = users.filter((u) => !u.bot).map((u) => u);

    if (!entries.length) {
      await ch.send("No valid entries, giveaway cancelled.");
      return;
    }

    const winners = [];
    const pool = [...entries];
    while (winners.length < winnersCount && pool.length) {
      const idx = Math.floor(Math.random() * pool.length);
      winners.push(pool.splice(idx, 1)[0]);
    }

    if (!winners.length) {
      await ch.send("No winners could be chosen.");
      return;
    }

    await ch.send({
      content: `🎉 Giveaway ended for **${sanitize(prize)}**!\nWinners: ${winners
        .map((u) => `<@${u.id}>`)
        .join(", ")}`
    });
  } catch (e) {
    console.log("Giveaway error:", e.message);
  }
}

// ======================================================
// =================== TICKETS BLOCK ====================
// ======================================================

async function createTicketChannel(type, interaction, fields) {
  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({ content: "No guild context.", ephemeral: true });
  }

  const isOrder = type === "order";
  const categoryName = isOrder ? CONFIG.ORDERS_CATEGORY_NAME : CONFIG.TICKETS_CATEGORY_NAME;
  const cat = await ensureCategory(guild, categoryName);
  if (!cat) {
    return interaction.reply({
      content: "Failed to create category, contact admin.",
      ephemeral: true
    });
  }

  const baseName = `${isOrder ? "order" : "support"}-${slug(interaction.user.username)}`;
  let finalName = baseName;
  let counter = 1;
  while (guild.channels.cache.find((c) => c.name === finalName)) {
    counter += 1;
    finalName = `${baseName}-${counter}`;
  }

  let ch;
  try {
    ch = await guild.channels.create({
      name: finalName,
      type: ChannelType.GuildText,
      parent: cat.id,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: ["ViewChannel"]
        },
        {
          id: interaction.user.id,
          allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"]
        }
      ],
      reason: isOrder ? "New order ticket" : "New support ticket"
    });
  } catch (e) {
    console.log("Ticket channel error:", e.message);
    return interaction.reply({
      content: "Failed to create ticket channel. Try again or contact admin.",
      ephemeral: true
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(isOrder ? "🛒 New Plugin Order" : "🛠️ New Support Ticket")
    .setColor(isOrder ? 0x00c896 : 0x3498db)
    .setDescription(
      isOrder
        ? `New plugin order from ${interaction.user}.\n\n` +
            `**Name:** ${fields.name}\n` +
            `**Plugin Idea / Link:** ${fields.idea}\n` +
            `**Budget:** ${fields.budget}\n` +
            `**Extra Details:** ${fields.extra || "None"}`
        : `New support ticket from ${interaction.user}.\n\n` +
            `**Name:** ${fields.name}\n` +
            `**Issue / Support Needed:** ${fields.issue}`
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("close_ticket")
      .setLabel("Close Ticket")
      .setStyle(ButtonStyle.Danger)
  );

  await ch.send({
    content: `${interaction.user} A staff member will get to you soon.`,
    embeds: [embed],
    components: [row]
  });

  await interaction.reply({
    content: `Your ${isOrder ? "order" : "support"} ticket has been created: ${ch}`,
    ephemeral: true
  });

  await sendLog(
    guild,
    makeLogEmbed(
      isOrder ? "New Order Ticket" : "New Support Ticket",
      interaction.user,
      interaction.user.tag,
      interaction.user.id,
      "Ticket created",
      `Channel: ${ch.name}`
    )
  );
}

// ======================================================
// ================== COMMANDS BLOCK ====================
// ======================================================

const slashCommands = [
  // Ping
  {
    name: "ping",
    description: "Check latency"
  },

  // Say
  {
    name: "say",
    description: "Make the bot send a message",
    options: [
      {
        name: "message",
        description: "Message to send",
        type: 3,
        required: true
      }
    ],
    default_member_permissions: String(PermissionFlagsBits.ManageGuild)
  },

  // Announce
  {
    name: "announce",
    description: "Send an announcement embed",
    options: [
      {
        name: "message",
        description: "Announcement content",
        type: 3,
        required: true
      },
      {
        name: "ping",
        description: "Ping everyone? (will be sanitized)",
        type: 5,
        required: false
      }
    ],
    default_member_permissions: String(PermissionFlagsBits.ManageGuild)
  },

  // Ask AI
  {
    name: "ask",
    description: "Ask the DevBot AI something",
    options: [
      {
        name: "question",
        description: "Your question",
        type: 3,
        required: true
      }
    ]
  },

  // Discount
  {
    name: "discount",
    description: "Post a discount offer",
    options: [
      {
        name: "amount",
        description: "Discount amount (e.g. 20%, $10 off)",
        type: 3,
        required: true
      },
      {
        name: "message",
        description: "Discount details",
        type: 3,
        required: true
      }
    ],
    default_member_permissions: String(PermissionFlagsBits.ManageGuild)
  },

  // Giveaway
  {
    name: "giveaway",
    description: "Start a giveaway",
    options: [
      {
        name: "winners",
        description: "Number of winners",
        type: 4,
        required: true
      },
      {
        name: "time",
        description: "Duration (e.g. 10m, 2h, 1d)",
        type: 3,
        required: true
      },
      {
        name: "prize",
        description: "What is the prize?",
        type: 3,
        required: true
      }
    ],
    default_member_permissions: String(PermissionFlagsBits.ManageGuild)
  },

  // Order panel
  {
    name: "orderpanel",
    description: "Post the order plugin panel",
    default_member_permissions: String(PermissionFlagsBits.ManageGuild)
  },

  // Support panel
  {
    name: "supportpanel",
    description: "Post the support ticket panel",
    default_member_permissions: String(PermissionFlagsBits.ManageGuild)
  },

  // Save log info
  {
    name: "save-log",
    description: "Show log channel info",
    default_member_permissions: String(PermissionFlagsBits.ManageGuild)
  },

  // Moderation: purge
  {
    name: "purge",
    description: "Bulk delete messages",
    options: [
      {
        name: "amount",
        description: "How many messages to delete (2–100)",
        type: 4,
        required: true
      }
    ],
    default_member_permissions: String(PermissionFlagsBits.ManageMessages)
  },

  // Moderation: ban / unban
  {
    name: "ban",
    description: "Ban or unban users",
    options: [
      {
        name: "add",
        description: "Ban a user",
        type: 1,
        options: [
          {
            name: "user",
            description: "User to ban",
            type: 6,
            required: true
          },
          {
            name: "reason",
            description: "Reason for ban",
            type: 3,
            required: false
          }
        ]
      },
      {
        name: "remove",
        description: "Unban a user by ID",
        type: 1,
        options: [
          {
            name: "userid",
            description: "User ID to unban",
            type: 3,
            required: true
          },
          {
            name: "reason",
            description: "Reason",
            type: 3,
            required: false
          }
        ]
      }
    ],
    default_member_permissions: String(PermissionFlagsBits.BanMembers)
  },

  // Moderation: tempban
  {
    name: "tempban",
    description: "Temporarily ban a user",
    options: [
      {
        name: "user",
        description: "User to tempban",
        type: 6,
        required: true
      },
      {
        name: "duration",
        description: "Duration (e.g. 30m, 2h, 1d)",
        type: 3,
        required: true
      },
      {
        name: "reason",
        description: "Reason",
        type: 3,
        required: false
      }
    ],
    default_member_permissions: String(PermissionFlagsBits.BanMembers)
  },

  // Moderation: kick
  {
    name: "kick",
    description: "Kick a user",
    options: [
      {
        name: "user",
        description: "User to kick",
        type: 6,
        required: true
      },
      {
        name: "reason",
        description: "Reason",
        type: 3,
        required: false
      }
    ],
    default_member_permissions: String(PermissionFlagsBits.KickMembers)
  },

  // Moderation: mute (timeout)
  {
    name: "mute",
    description: "Timeout a user",
    options: [
      {
        name: "user",
        description: "User to mute",
        type: 6,
        required: true
      },
      {
        name: "duration",
        description: "Duration (optional, 10m / 2h / 1d). Leave empty for permanent.",
        type: 3,
        required: false
      },
      {
        name: "reason",
        description: "Reason",
        type: 3,
        required: false
      }
    ],
    default_member_permissions: String(PermissionFlagsBits.ModerateMembers)
  },

  // Moderation: unmute
  {
    name: "unmute",
    description: "Remove timeout from user",
    options: [
      {
        name: "user",
        description: "User to unmute",
        type: 6,
        required: true
      }
    ],
    default_member_permissions: String(PermissionFlagsBits.ModerateMembers)
  }
];

async function registerCommands() {
  if (!process.env.TOKEN) {
    console.log("TOKEN missing — skipping slash registration");
    return;
  }
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  const appId = (await client.application.fetch()).id;

  try {
    await rest.put(Routes.applicationCommands(appId), { body: slashCommands });
    console.log("Global commands registered.");
  } catch (e) {
    console.log("Error registering global commands:", e.message);
  }
}

// ======================================================
// ============= AUTO PANELS & WELCOME BLOCK ============
// ======================================================

async function cleanChannelPanels(channel, footerMatch) {
  if (!channel) return;
  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    const old = messages.filter(
      (m) =>
        m.author.id === client.user.id &&
        m.embeds[0] &&
        m.embeds[0].footer &&
        m.embeds[0].footer.text === footerMatch
    );
    for (const msg of old.values()) {
      await msg.delete().catch(() => {});
    }
  } catch (e) {
    console.log("Cleanup error:", e.message);
  }
}

async function setupGuildPanels(guild) {
  try {
    await ensureCategory(guild, CONFIG.ORDERS_CATEGORY_NAME);
    await ensureCategory(guild, CONFIG.TICKETS_CATEGORY_NAME);
    await ensureLogChannel(guild);

    const rulesCh = getChannel(guild, CONFIG.RULES_CHANNEL);
    const orderCh = getChannel(guild, CONFIG.ORDER_CHANNEL);
    const showcaseCh = getChannel(guild, CONFIG.SHOWCASE_CHANNEL);
    const reviewsCh = getChannel(guild, CONFIG.REVIEWS_CHANNEL);

    // Rules / support panel
    if (rulesCh) {
      await cleanChannelPanels(rulesCh, CONFIG.AUTO_PANEL_FOOTER);

      const rulesEmbed = new EmbedBuilder()
        .setTitle("📜 Service Rules")
        .setDescription(
          [
            "Welcome to Phantom's Dev Commissions server.",
            "",
            "• Be respectful and keep it SFW.",
            "• No spam, scams, or hate of any kind.",
            "• All payments and commissions must stay inside official channels.",
            "• Do not DM the dev randomly for free work — use the order system.",
            "",
            "If you need help, use the support panel below."
          ].join("\n")
        )
        .setColor(0xf1c40f)
        .setFooter({ text: CONFIG.AUTO_PANEL_FOOTER });

      const supportEmbed = new EmbedBuilder()
        .setTitle("🛠️ Support Panel")
        .setDescription(
          "Need help with an order, bug, or question?\nClick the button below to create a **support ticket**."
        )
        .setColor(0x3498db)
        .setFooter({ text: CONFIG.AUTO_PANEL_FOOTER });

      const supportRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("support_open")
          .setLabel("Create Support Ticket")
          .setStyle(ButtonStyle.Primary)
      );

      await rulesCh.send({ embeds: [rulesEmbed] });
      await rulesCh.send({ embeds: [supportEmbed], components: [supportRow] });
    }

    // Order panel
    if (orderCh) {
      await cleanChannelPanels(orderCh, CONFIG.AUTO_PANEL_FOOTER);

      const orderEmbed = new EmbedBuilder()
        .setTitle("🛒 Order a Custom Plugin")
        .setDescription(
          [
            "Want a custom **Minecraft plugin** or system coded?",
            "",
            "Click the button below to submit an order:",
            "",
            "• Simple utilities, commands, QoL plugins",
            "• SMP systems, abilities, custom items",
            "• Mini-games, events, progression systems",
            "",
            "All work is handled by **Phantom (Utaib)** — experienced dev who coded Oni SMP plugins and more."
          ].join("\n")
        )
        .setColor(0x00c896)
        .setFooter({ text: CONFIG.AUTO_PANEL_FOOTER });

      const orderRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("order_open")
          .setLabel("Order Plugin")
          .setStyle(ButtonStyle.Success)
      );

      await orderCh.send({ embeds: [orderEmbed], components: [orderRow] });
    }

    // Showcase
    if (showcaseCh) {
      await cleanChannelPanels(showcaseCh, CONFIG.AUTO_PANEL_FOOTER);

      const showcaseEmbed = new EmbedBuilder()
        .setTitle("✨ Showcases Coming Soon")
        .setDescription(
          [
            "This channel will feature previews of plugins, systems, and commissions made here.",
            "",
            "This is **Phantom (Utaib)** — a developer with years of experience.",
            "He has coded plugins for servers like **Oni SMP** and many other projects.",
            "",
            `Check <#${CONFIG.ORDER_CHANNEL}> to order your own custom plugin.`
          ].join("\n")
        )
        .setColor(0x9b59b6)
        .setFooter({ text: CONFIG.AUTO_PANEL_FOOTER });

      await showcaseCh.send({ embeds: [showcaseEmbed] });
    }

    // Reviews
    if (reviewsCh) {
      await cleanChannelPanels(reviewsCh, CONFIG.AUTO_PANEL_FOOTER);

      const reviewsEmbed = new EmbedBuilder()
        .setTitle("⭐ Leave a Review")
        .setDescription(
          [
            "Already got a plugin or help from Phantom?",
            "",
            "Drop your honest review here:",
            "• How was communication?",
            "• Did the plugin match your idea?",
            "• Would you recommend working with him again?",
            "",
            "Your feedback helps improve the service and builds trust for new clients."
          ].join("\n")
        )
        .setColor(0xf39c12)
        .setFooter({ text: CONFIG.AUTO_PANEL_FOOTER });

      await reviewsCh.send({ embeds: [reviewsEmbed] });
    }
  } catch (e) {
    console.log("setupGuildPanels error:", e.message);
  }
}

// ======================================================
// ================= JOIN / LEAVE BLOCK =================
// ======================================================

client.on("guildMemberAdd", async (member) => {
  try {
    const ch = getChannel(member.guild, CONFIG.JOINS_LEAVES_CHANNEL);
    if (!ch || ch.type !== ChannelType.GuildText) return;

    const embed = new EmbedBuilder()
      .setTitle("✅ New Member")
      .setDescription(
        `Welcome ${member}!\n\nThis server is focused on **Minecraft plugin commissions & dev support**.\nCheck <#${CONFIG.ORDER_CHANNEL}> to order or <#${CONFIG.RULES_CHANNEL}> for info.`
      )
      .setColor(0x2ecc71)
      .setTimestamp();

    await ch.send({ embeds: [embed] });
  } catch (e) {
    console.log("guildMemberAdd error:", e.message);
  }
});

client.on("guildMemberRemove", async (member) => {
  try {
    if (!member.guild) return;
    const ch = getChannel(member.guild, CONFIG.JOINS_LEAVES_CHANNEL);
    if (!ch || ch.type !== ChannelType.GuildText) return;

    const embed = new EmbedBuilder()
      .setTitle("❌ Member Left")
      .setDescription(`${member.user.tag} just left the server.`)
      .setColor(0xe74c3c)
      .setTimestamp();

    await ch.send({ embeds: [embed] });
  } catch (e) {
    console.log("guildMemberRemove error:", e.message);
  }
});

// ======================================================
// ================= INTERACTIONS BLOCK =================
// ======================================================

client.on("interactionCreate", async (interaction) => {
  try {
    // ------------- BUTTONS -------------
    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id === "order_open") {
        const modal = new ModalBuilder()
          .setCustomId("order_modal")
          .setTitle("Order a Plugin");

        const name = new TextInputBuilder()
          .setCustomId("order_name")
          .setLabel("Your Name / IGN")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const idea = new TextInputBuilder()
          .setCustomId("order_idea")
          .setLabel("Plugin idea (describe or send link)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        const budget = new TextInputBuilder()
          .setCustomId("order_budget")
          .setLabel("Budget (currency optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const extra = new TextInputBuilder()
          .setCustomId("order_extra")
          .setLabel("Extra details (optional)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(name),
          new ActionRowBuilder().addComponents(idea),
          new ActionRowBuilder().addComponents(budget),
          new ActionRowBuilder().addComponents(extra)
        );

        return interaction.showModal(modal);
      }

      if (id === "support_open") {
        const modal = new ModalBuilder()
          .setCustomId("support_modal")
          .setTitle("Support Ticket");

        const name = new TextInputBuilder()
          .setCustomId("support_name")
          .setLabel("Your Name / IGN")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const issue = new TextInputBuilder()
          .setCustomId("support_issue")
          .setLabel("What do you need help with?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(name),
          new ActionRowBuilder().addComponents(issue)
        );

        return interaction.showModal(modal);
      }

      if (id === "close_ticket") {
        const ch = interaction.channel;
        if (!ch) {
          return interaction.reply({ content: "No channel context.", ephemeral: true });
        }

        await interaction.reply({
          content: "Ticket will be closed in a few seconds.",
          ephemeral: true
        });

        await sendLog(
          interaction.guild,
          makeLogEmbed(
            "Ticket Closed",
            interaction.user,
            interaction.user.tag,
            interaction.user.id,
            "Ticket closed",
            `Channel: ${ch.name}`
          )
        );

        setTimeout(() => {
          ch.delete().catch(() => {});
        }, 4000);
        return;
      }

      return;
    }

    // ------------- MODALS -------------
    if (interaction.isModalSubmit()) {
      if (interaction.customId === "order_modal") {
        const fields = {
          name: interaction.fields.getTextInputValue("order_name"),
          idea: interaction.fields.getTextInputValue("order_idea"),
          budget: interaction.fields.getTextInputValue("order_budget"),
          extra: interaction.fields.getTextInputValue("order_extra") || "None"
        };
        return createTicketChannel("order", interaction, fields);
      }

      if (interaction.customId === "support_modal") {
        const fields = {
          name: interaction.fields.getTextInputValue("support_name"),
          issue: interaction.fields.getTextInputValue("support_issue")
        };
        return createTicketChannel("support", interaction, fields);
      }

      return;
    }

    // ------------- SLASH COMMANDS -------------
    if (!interaction.isChatInputCommand()) return;
    const cmd = interaction.commandName;
    const hasPerm = (perm) => {
      try {
        return interaction.member.permissions.has(perm);
      } catch {
        return false;
      }
    };

    // /ping
    if (cmd === "ping") {
      const before = Date.now();
      await interaction.reply("Pinging…");
      const latency = Date.now() - before;
      return interaction.followUp(
        `🏓 Pong — ${latency}ms (WS: ${Math.round(client.ws.ping)}ms)`
      );
    }

    // /say
    if (cmd === "say") {
      if (!hasPerm(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: "No perms.", ephemeral: true });
      }
      const message = interaction.options.getString("message");
      await interaction.channel.send(sanitize(message));
      return interaction.reply({ content: "Sent!", ephemeral: true });
    }

    // /announce
    if (cmd === "announce") {
      if (!hasPerm(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: "No perms.", ephemeral: true });
      }
      const msg = interaction.options.getString("message");
      const ping = interaction.options.getBoolean("ping") || false;

      const embed = new EmbedBuilder()
        .setTitle("📣 Announcement")
        .setDescription(sanitize(msg))
        .setColor(0xffaa00)
        .setTimestamp();

      if (ping) {
        await interaction.channel.send({ content: "@eeee", embeds: [embed] });
      } else {
        await interaction.channel.send({ embeds: [embed] });
      }

      return interaction.reply({ content: "Announcement posted!", ephemeral: true });
    }

    // /ask
    if (cmd === "ask") {
      const q = interaction.options.getString("question");
      await interaction.deferReply();
      const ans = await askDevAI(q, interaction.user.id);
      return interaction.editReply(sanitize(ans));
    }

    // /discount
    if (cmd === "discount") {
      if (!hasPerm(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: "No perms.", ephemeral: true });
      }
      const amount = interaction.options.getString("amount");
      const msg = interaction.options.getString("message");
      const guild = interaction.guild;
      const ch = getChannel(guild, CONFIG.DISCOUNTS_CHANNEL);

      if (!ch) {
        return interaction.reply({
          content: "Discounts channel not found in config.",
          ephemeral: true
        });
      }

      await cleanChannelPanels(ch, CONFIG.DISCOUNT_FOOTER);

      const embed = new EmbedBuilder()
        .setTitle("🔥 New Discount Active")
        .setDescription(
          [
            `**Discount:** ${sanitize(amount)}`,
            "",
            sanitize(msg),
            "",
            "Use this chance to get your plugin idea built."
          ].join("\n")
        )
        .setColor(0xe67e22)
        .setFooter({ text: CONFIG.DISCOUNT_FOOTER })
        .setTimestamp();

      await ch.send({ embeds: [embed] });
      return interaction.reply({ content: "Discount posted.", ephemeral: true });
    }

    // /giveaway
    if (cmd === "giveaway") {
      if (!hasPerm(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: "No perms.", ephemeral: true });
      }
      const winners = interaction.options.getInteger("winners");
      const time = interaction.options.getString("time");
      const prize = interaction.options.getString("prize");

      if (winners < 1) {
        return interaction.reply({
          content: "Winners must be at least 1.",
          ephemeral: true
        });
      }

      const ms = parseDurationToMs(time);
      if (!ms) {
        return interaction.reply({
          content: "Invalid time format. Use 10m, 2h, 1d etc.",
          ephemeral: true
        });
      }

      const ch = getChannel(interaction.guild, CONFIG.GIVEAWAY_CHANNEL);
      if (!ch || ch.type !== ChannelType.GuildText) {
        return interaction.reply({
          content: "Giveaway channel not found / invalid.",
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("🎉 Giveaway")
        .setDescription(
          [
            `Hosted by: ${interaction.user}`,
            "",
            `**Prize:** ${sanitize(prize)}`,
            `**Winners:** ${winners}`,
            `**Duration:** ${sanitize(time)}`,
            "",
            "React with 🎉 to enter!"
          ].join("\n")
        )
        .setColor(0x1abc9c)
        .setFooter({ text: CONFIG.GIVEAWAY_FOOTER })
        .setTimestamp();

      const msg = await ch.send({ embeds: [embed] });
      await msg.react("🎉").catch(() => {});

      const key = `giveaway:${interaction.guild.id}:${msg.id}`;
      if (giveawayTimers.has(key)) clearTimeout(giveawayTimers.get(key));
      const t = setTimeout(() => {
        runGiveaway(interaction.guild, ch.id, msg.id, winners, prize);
        giveawayTimers.delete(key);
      }, ms);
      giveawayTimers.set(key, t);

      return interaction.reply({
        content: `Giveaway started in ${ch}!`,
        ephemeral: true
      });
    }

    // /orderpanel
    if (cmd === "orderpanel") {
      if (!hasPerm(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: "No perms.", ephemeral: true });
      }
      const guild = interaction.guild;
      const ch = getChannel(guild, CONFIG.ORDER_CHANNEL) || interaction.channel;

      await cleanChannelPanels(ch, CONFIG.AUTO_PANEL_FOOTER);

      const embed = new EmbedBuilder()
        .setTitle("🛒 Order a Custom Plugin")
        .setDescription(
          "Click the button below to submit your plugin idea as a commission ticket."
        )
        .setColor(0x00c896)
        .setFooter({ text: CONFIG.AUTO_PANEL_FOOTER });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("order_open")
          .setLabel("Order Plugin")
          .setStyle(ButtonStyle.Success)
      );

      await ch.send({ embeds: [embed], components: [row] });
      return interaction.reply({ content: "Order panel posted.", ephemeral: true });
    }

    // /supportpanel
    if (cmd === "supportpanel") {
      if (!hasPerm(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: "No perms.", ephemeral: true });
      }
      const guild = interaction.guild;
      const ch = getChannel(guild, CONFIG.RULES_CHANNEL) || interaction.channel;

      await cleanChannelPanels(ch, CONFIG.AUTO_PANEL_FOOTER);

      const embed = new EmbedBuilder()
        .setTitle("🛠️ Support Panel")
        .setDescription(
          "Click the button below to open a support ticket for any issues or questions."
        )
        .setColor(0x3498db)
        .setFooter({ text: CONFIG.AUTO_PANEL_FOOTER });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("support_open")
          .setLabel("Create Support Ticket")
          .setStyle(ButtonStyle.Primary)
      );

      await ch.send({ embeds: [embed], components: [row] });
      return interaction.reply({ content: "Support panel posted.", ephemeral: true });
    }

    // /save-log
    if (cmd === "save-log") {
      if (!hasPerm(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: "No perms.", ephemeral: true });
      }
      const ch = getLogChannelCached(interaction.guild) || (await ensureLogChannel(interaction.guild));
      return interaction.reply({
        content:
          `Log Channel ID: **${ch?.id || "None"}**\n\n` +
          `You can set ENV: **MOD_LOG_${interaction.guild.id} = ${ch?.id || "CHANNEL_ID"}**`,
        ephemeral: true
      });
    }

    // /purge
    if (cmd === "purge") {
      if (!hasPerm(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({ content: "No perms.", ephemeral: true });
      }
      const amount = interaction.options.getInteger("amount");
      if (amount < 2 || amount > 100) {
        return interaction.reply({
          content: "Amount must be between 2 and 100.",
          ephemeral: true
        });
      }
      const deleted = await interaction.channel.bulkDelete(amount, true).catch(() => null);
      if (!deleted) {
        return interaction.reply({
          content: "Failed to delete messages. (Maybe too old?)",
          ephemeral: true
        });
      }
      return interaction.reply({
        content: `Deleted ${deleted.size} messages.`,
        ephemeral: true
      });
    }

    // /ban
    if (cmd === "ban") {
      const sub = interaction.options.getSubcommand();
      if (!hasPerm(PermissionFlagsBits.BanMembers)) {
        return interaction.reply({ content: "No perms.", ephemeral: true });
      }

      if (sub === "add") {
        const user = interaction.options.getUser("user");
        const reason = interaction.options.getString("reason") || "No reason provided";

        await user
          .send({ embeds: [makeActionDMEmbed(interaction.guild, "ban", reason)] })
          .catch(() => {});

        try {
          await interaction.guild.members.ban(user.id, { reason });
        } catch (e) {
          return interaction.reply({
            content: `Failed to ban: ${e.message}`,
            ephemeral: true
          });
        }

        await sendLog(
          interaction.guild,
          makeLogEmbed("User Banned", interaction.user, user.tag, user.id, reason)
        );

        return interaction.reply({
          content: `🔨 Banned **${user.tag}**`,
          ephemeral: true
        });
      }

      if (sub === "remove") {
        const rawId = interaction.options.getString("userid");
        const id = rawId.replace(/\D/g, "");
        const reason = interaction.options.getString("reason") || "Unbanned";

        try {
          await interaction.guild.bans.remove(id, reason);
        } catch (e) {
          return interaction.reply({
            content: `Failed to unban: ${e.message}`,
            ephemeral: true
          });
        }

        await sendLog(
          interaction.guild,
          makeLogEmbed("User Unbanned", interaction.user, id, id, reason)
        );

        return interaction.reply({
          content: `Unbanned **${id}**`,
          ephemeral: true
        });
      }
    }

    // /tempban
    if (cmd === "tempban") {
      if (!hasPerm(PermissionFlagsBits.BanMembers)) {
        return interaction.reply({ content: "No perms.", ephemeral: true });
      }

      const user = interaction.options.getUser("user");
      const duration = interaction.options.getString("duration");
      const ms = parseDurationToMs(duration);
      const reason = interaction.options.getString("reason") || "No reason provided";

      if (!ms) {
        return interaction.reply({
          content: "Invalid duration format. Use 10m, 2h, 1d etc.",
          ephemeral: true
        });
      }

      await user
        .send({
          embeds: [makeActionDMEmbed(interaction.guild, "tempban", reason, duration)]
        })
        .catch(() => {});

      try {
        await interaction.guild.members.ban(user.id, { reason });
      } catch (e) {
        return interaction.reply({
          content: `Failed to tempban: ${e.message}`,
          ephemeral: true
        });
      }

      const key = `tempban:${interaction.guild.id}:${user.id}`;
      if (tempTimers.has(key)) clearTimeout(tempTimers.get(key));

      tempTimers.set(
        key,
        setTimeout(async () => {
          await interaction.guild.bans.remove(user.id).catch(() => {});
          await sendLog(
            interaction.guild,
            makeLogEmbed(
              "Tempban expired",
              client.user,
              user.tag,
              user.id,
              "Tempban expired"
            )
          );
        }, ms)
      );

      await sendLog(
        interaction.guild,
        makeLogEmbed(
          "User Tempbanned",
          interaction.user,
          user.tag,
          user.id,
          reason,
          `Duration: ${duration}`
        )
      );

      return interaction.reply({
        content: `⏳ Tempbanned **${user.tag}** for **${duration}**`,
        ephemeral: true
      });
    }

    // /kick
    if (cmd === "kick") {
      if (!hasPerm(PermissionFlagsBits.KickMembers)) {
        return interaction.reply({ content: "No perms.", ephemeral: true });
      }
      const user = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason") || "No reason provided";
      const member = interaction.guild.members.cache.get(user.id);

      if (!member) {
        return interaction.reply({
          content: "User not in guild.",
          ephemeral: true
        });
      }

      await user
        .send({ embeds: [makeActionDMEmbed(interaction.guild, "kick", reason)] })
        .catch(() => {});

      await member.kick(reason).catch(() => {});

      await sendLog(
        interaction.guild,
        makeLogEmbed("User Kicked", interaction.user, user.tag, user.id, reason)
      );

      return interaction.reply({
        content: `👢 Kicked **${user.tag}**`,
        ephemeral: true
      });
    }

    // /mute
    if (cmd === "mute") {
      if (!hasPerm(PermissionFlagsBits.ModerateMembers)) {
        return interaction.reply({ content: "No perms.", ephemeral: true });
      }

      const user = interaction.options.getUser("user");
      const duration = interaction.options.getString("duration");
      const ms = duration ? parseDurationToMs(duration) : null;
      const reason = interaction.options.getString("reason") || "No reason provided";
      const member = interaction.guild.members.cache.get(user.id);

      if (!member) {
        return interaction.reply({
          content: "User not found in guild.",
          ephemeral: true
        });
      }

      await user
        .send({
          embeds: [
            makeActionDMEmbed(
              interaction.guild,
              "timeout",
              reason,
              duration || "Permanent"
            )
          ]
        })
        .catch(() => {});

      await member.timeout(ms || 0, reason).catch(() => {});

      if (ms) {
        const key = `timeout:${interaction.guild.id}:${user.id}`;
        if (tempTimers.has(key)) clearTimeout(tempTimers.get(key));
        tempTimers.set(
          key,
          setTimeout(async () => {
            const m = interaction.guild.members.cache.get(user.id);
            if (m) await m.timeout(null).catch(() => {});
            await sendLog(
              interaction.guild,
              makeLogEmbed(
                "Timeout expired",
                client.user,
                user.tag,
                user.id,
                "Timeout expired"
              )
            );
          }, ms)
        );
      }

      await sendLog(
        interaction.guild,
        makeLogEmbed(
          "User Muted",
          interaction.user,
          user.tag,
          user.id,
          reason,
          duration ? `Duration: ${duration}` : "Permanent"
        )
      );

      return interaction.reply({
        content: `🔇 Muted **${user.tag}**`,
        ephemeral: true
      });
    }

    // /unmute
    if (cmd === "unmute") {
      if (!hasPerm(PermissionFlagsBits.ModerateMembers)) {
        return interaction.reply({ content: "No perms.", ephemeral: true });
      }

      const user = interaction.options.getUser("user");
      const member = interaction.guild.members.cache.get(user.id);

      if (!member) {
        return interaction.reply({
          content: "User not found in guild.",
          ephemeral: true
        });
      }

      await member.timeout(null).catch(() => {});
      await sendLog(
        interaction.guild,
        makeLogEmbed("User Unmuted", interaction.user, user.tag, user.id, "Unmuted")
      );

      return interaction.reply({
        content: `🔊 Unmuted **${user.tag}**`,
        ephemeral: true
      });
    }
  } catch (e) {
    console.log("interactionCreate error:", e);
    if (interaction.isRepliable()) {
      interaction
        .reply({ content: "Something broke handling that interaction.", ephemeral: true })
        .catch(() => {});
    }
  }
});

// ======================================================
// ================= MESSAGE HANDLER BLOCK ==============
// ======================================================

client.on("messageCreate", async (msg) => {
  try {
    if (msg.author.bot) return;
    if (!msg.guild) return;

    const botId = client.user.id;

    // If message replies to bot
    if (msg.reference?.messageId) {
      const ref = await msg.channel.messages.fetch(msg.reference.messageId).catch(() => null);
      if (ref && ref.author.id === botId) {
        msg.channel.sendTyping();
        const ans = await askDevAI(msg.content, msg.author.id);
        return msg.reply(sanitize(ans));
      }
    }

    // If directly mentioned
    if (msg.mentions.has(botId, { ignoreRoles: true, ignoreEveryone: true })) {
      const clean = msg.content.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim() || "yo";
      msg.channel.sendTyping();
      const ans = await askDevAI(clean, msg.author.id);
      return msg.reply(sanitize(ans));
    }
  } catch (e) {
    console.log("messageCreate error:", e.message);
  }
});

// ======================================================
// ====================== READY BLOCK ===================
// ======================================================

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();

  // Setup panels per guild
  for (const guild of client.guilds.cache.values()) {
    await setupGuildPanels(guild);
  }
});

// ======================================================
// ====================== LOGIN BLOCK ===================
// ======================================================

if (!process.env.TOKEN) {
  console.log("❌ ERROR: TOKEN not set in environment variables.");
  process.exit(1);
}

client
  .login(process.env.TOKEN)
  .then(() => console.log("Dev Commission Bot started successfully!"))
  .catch((err) => {
    console.error("Login failed:", err.message);
    process.exit(1);
  });

