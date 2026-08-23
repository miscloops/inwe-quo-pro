// Seed for chat.inweapp.com gifting console — mimics a Bangladesh chat room
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const GIFT_TEMPLATES = [
  // Popular
  { name: 'Rose', emoji: '🌹', color: '#f43f5e', price: 10, category: 'popular', description: 'A single red rose' },
  { name: 'Ice Cream', emoji: '🍦', color: '#22d3ee', price: 30, category: 'popular', description: 'Sweet treat' },
  { name: 'Coffee', emoji: '☕', color: '#a16207', price: 50, category: 'popular', description: 'Morning boost' },
  { name: 'Pizza', emoji: '🍕', color: '#ef4444', price: 80, category: 'popular', description: 'Slice of joy' },
  { name: 'Cake', emoji: '🎂', color: '#fb7185', price: 120, category: 'popular', description: 'Birthday cake' },
  // Interaction
  { name: 'Heart', emoji: '❤️', color: '#ef4444', price: 5, category: 'interaction', description: 'Send some love' },
  { name: 'Thumbs Up', emoji: '👍', color: '#3b82f6', price: 5, category: 'interaction', description: 'Well done!' },
  { name: 'Fire', emoji: '🔥', color: '#f97316', price: 15, category: 'interaction', description: 'You are on fire!' },
  { name: 'Clap', emoji: '👏', color: '#eab308', price: 15, category: 'interaction', description: 'Applause' },
  // Premium
  { name: 'Crown', emoji: '👑', color: '#facc15', price: 500, category: 'premium', description: 'For the king/queen' },
  { name: 'Diamond Ring', emoji: '💍', color: '#67e8f9', price: 1000, category: 'premium', description: 'A shiny proposal' },
  { name: 'Sports Car', emoji: '🏎️', color: '#fb7185', price: 2500, category: 'premium', description: 'Vroom vroom' },
  { name: 'Rocket', emoji: '🚀', color: '#818cf8', price: 5000, category: 'premium', description: 'To the moon' },
  { name: 'Castle', emoji: '🏰', color: '#c084fc', price: 10000, category: 'premium', description: 'A royal estate' },
  // Seasonal
  { name: 'Lucky Star', emoji: '⭐', color: '#fbbf24', price: 100, category: 'seasonal', description: 'Make a wish' },
  { name: 'Moon', emoji: '🌙', color: '#94a3b8', price: 200, category: 'seasonal', description: 'Good night' },
  { name: 'Dragon', emoji: '🐉', color: '#10b981', price: 3000, category: 'seasonal', description: 'Year of the dragon' },
  { name: 'Pumpkin', emoji: '🎃', color: '#f97316', price: 75, category: 'seasonal', description: 'Spooky season' },
]

// Realistic Bangladeshi / South Asian usernames to match the "Bangladesh" room
const USERS = [
  { username: 'mindstorm', displayName: 'mindstorm', level: 3, balance: 15420, isCurrentUser: true },
  { username: 'rafique_bd', displayName: 'Rafique', level: 12, balance: 2300 },
  { username: 'sumaiya.akter', displayName: 'Sumaiya Akter', level: 7, balance: 890 },
  { username: 'tanvir_rahman', displayName: 'Tanvir Rahman', level: 18, balance: 45600 },
  { username: 'nusrat99', displayName: 'Nusrat Jahan', level: 5, balance: 320 },
  { username: 'imran_hossain', displayName: 'Imran Hossain', level: 22, balance: 89200 },
  { username: 'farzana.k', displayName: 'Farzana K', level: 9, balance: 1500 },
  { username: 'arif_007', displayName: 'Arif Khan', level: 14, balance: 7800 },
  { username: 'lipi_akter', displayName: 'Lipi Akter', level: 6, balance: 410 },
  { username: 'sajid_hasan', displayName: 'Sajid Hasan', level: 31, balance: 215000 },
  { username: 'mim_dhaka', displayName: 'Mim Dhaka', level: 8, balance: 980 },
  { username: 'gifty_bot', displayName: 'Gifty Bot', level: 99, balance: 9999999, isBot: true },
]

const CHAT_MESSAGES = [
  { sender: 'rafique_bd', text: 'salaam everyone 👋' },
  { sender: 'sumaiya.akter', text: 'wa salaam Rafique bhai' },
  { sender: 'tanvir_rahman', text: 'anyone watching the match today?' },
  { sender: 'imran_hossain', text: 'yes bro, watching now' },
  { sender: 'nusrat99', text: 'which channel?' },
  { sender: 'arif_007', text: 'T Sports channel' },
  { sender: 'farzana.k', text: 'hello from Chittagong 🌊' },
  { sender: 'lipi_akter', text: 'how is everyone today?' },
  { sender: 'sajid_hasan', text: 'alhamdulillah, doing great' },
  { sender: 'mim_dhaka', text: 'just got back from work, tired 😴' },
  { sender: 'rafique_bd', text: 'same here, long day' },
  { sender: 'tanvir_rahman', text: 'rest well sis' },
]

const RECENT_GIFTS = [
  { sender: 'sajid_hasan', recipient: 'mim_dhaka', giftName: 'Crown', message: 'you deserve it 👑' },
  { sender: 'gifty_bot', recipient: 'sumaiya.akter', giftName: 'Rose', message: 'welcome to the room! 🌹', isBot: true },
  { sender: 'imran_hossain', recipient: 'tanvir_rahman', giftName: 'Coffee', message: 'for the match ☕' },
  { sender: 'arif_007', recipient: 'farzana.k', giftName: 'Rose', message: 'hello from Dhaka 🌹' },
  { sender: 'sajid_hasan', recipient: 'lipi_akter', giftName: 'Heart', message: '' },
]

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min }

async function main() {
  console.log('Seeding inweapp gifting console data...')

  await db.giftMessage.deleteMany()
  await db.chatMessage.deleteMany()
  await db.gift.deleteMany()
  await db.chatRoom.deleteMany()
  await db.user.deleteMany()

  // Users
  const userIds: Record<string, string> = {}
  for (const u of USERS) {
    const created = await db.user.create({
      data: {
        username: u.username,
        displayName: u.displayName,
        level: u.level,
        coinBalance: u.balance,
        isBot: u.isBot ?? false,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.username)}`,
      },
    })
    userIds[u.username] = created.id
  }

  // Room
  const room = await db.chatRoom.create({
    data: { name: 'Bangladesh', capacity: 50, icon: '🇧🇩' },
  })

  // Gifts
  const giftIds: Record<string, string> = {}
  for (const g of GIFT_TEMPLATES) {
    const created = await db.gift.create({
      data: {
        name: g.name,
        emoji: g.emoji,
        iconColor: g.color,
        price: g.price,
        category: g.category,
        description: g.description,
        enabled: true,
      },
    })
    giftIds[g.name] = created.id
  }

  // Chat messages (last 10 mins)
  const now = Date.now()
  for (let i = 0; i < CHAT_MESSAGES.length; i++) {
    const m = CHAT_MESSAGES[i]
    await db.chatMessage.create({
      data: {
        roomId: room.id,
        senderId: userIds[m.sender],
        text: m.text,
        createdAt: new Date(now - (CHAT_MESSAGES.length - i) * 60_000),
      },
    })
  }

  // Recent gifts (interspersed)
  for (let i = 0; i < RECENT_GIFTS.length; i++) {
    const g = RECENT_GIFTS[i]
    await db.giftMessage.create({
      data: {
        roomId: room.id,
        giftId: giftIds[g.giftName],
        senderId: userIds[g.sender],
        recipientId: userIds[g.recipient],
        message: g.message || null,
        isFromBot: g.isBot ?? false,
        createdAt: new Date(now - (RECENT_GIFTS.length - i) * 90_000 + randInt(0, 30_000)),
      },
    })
  }

  console.log(`Seeded ${USERS.length} users, ${GIFT_TEMPLATES.length} gifts, 1 room (${room.name}), ${CHAT_MESSAGES.length} chat messages, ${RECENT_GIFTS.length} gift messages`)
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
