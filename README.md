# JD Vector - AI-Powered Skill Question Generator

An intelligent interview question generator that uses AI and vector embeddings to create and store relevant questions for any skill.

## Features

- 🤖 **AI-Powered Generation**: Uses OpenAI GPT-4.1 to generate relevant interview questions
- 🔍 **Vector Embeddings**: Stores question embeddings using OpenAI's text-embedding-3-small model
- 💾 **Smart Caching**: Automatically caches generated questions to avoid redundant AI calls
- 🎯 **Skill-Based Organization**: Organizes questions by specific skills
- ⚡ **Fast Performance**: Built with Next.js 15 and Turbopack for optimal development experience

## Tech Stack

- **Frontend**: Next.js 15, React 19, TailwindCSS 4
- **Backend**: Next.js API Routes
- **Database**: PostgreSQL with Prisma ORM
- **AI**: OpenAI GPT-4.1 for generation, text-embedding-3-small for embeddings
- **Language**: TypeScript

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend UI   │───▶│   API Routes     │───▶│   PostgreSQL    │
│                 │    │                  │    │                 │
│ - Skill Input   │    │ - Question Gen   │    │ - Skills        │
│ - Question List │    │ - Embeddings     │    │ - Questions     │
│                 │    │ - Caching        │    │ - Embeddings    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │   OpenAI API     │
                       │                  │
                       │ - GPT-4.1        │
                       │ - Embeddings     │
                       └──────────────────┘
```

## Prerequisites

- Node.js 18+
- PostgreSQL database
- OpenAI API key

## Installation

1. **Clone the repository**

   ```bash
   git clone <your-repo-url>
   cd jd-vector
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**

   Create a `.env.local` file in the root directory:

   ```env
   # OpenAI API Configuration
   OPENAI_API_KEY=your_openai_api_key_here

   # Database Configuration
   DATABASE_URL="postgresql://username:password@localhost:5432/jd_vector"
   ```

4. **Set up the database**

   ```bash
   # Generate Prisma client
   npx prisma generate

   # Run database migrations
   npx prisma migrate deploy

   # (Optional) Open Prisma Studio to view data
   npx prisma studio
   ```

## Usage

1. **Start the development server**

   ```bash
   npm run dev
   ```

2. **Open your browser**

   Navigate to `http://localhost:3000`

3. **Generate questions**
   - Enter a skill name (e.g., "React", "Python", "Machine Learning")
   - Click "Generate Questions"
   - View the AI-generated interview questions

## How It Works

### Question Generation Flow

1. **Input**: User enters a skill name
2. **Check Cache**: System checks if questions already exist for this skill
3. **Generate**: If not cached, generates 5 new questions using OpenAI GPT-4.1
4. **Embed**: Creates vector embeddings for each question using OpenAI's embedding model
5. **Store**: Saves questions and embeddings to PostgreSQL database
6. **Return**: Displays questions to the user

### Database Schema

```sql
-- Skills table
model Skill {
  id        Int         @id @default(autoincrement())
  name      String      @unique
  questions Question[]
}

-- Questions table with embeddings
model Question {
  id        Int     @id @default(autoincrement())
  skill     Skill   @relation(fields: [skillId], references: [id])
  skillId   Int
  text      String
  embedding Json    -- Vector embeddings stored as JSON
}
```

### API Endpoints

- `POST /api/skills/generate` - Generate questions for a skill
  - **Body**: `{ "skillName": "React" }`
  - **Response**: `{ "questions": [...], "source": "generated|existing" }`

## Development

### Available Scripts

- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

### Database Operations

```bash
# View your data
npx prisma studio

# Reset database (caution: deletes all data)
npx prisma migrate reset

# Deploy migrations to production
npx prisma migrate deploy
```

## Features in Detail

### Smart Caching

- Questions are automatically cached after first generation
- Subsequent requests for the same skill return existing questions instantly
- Reduces API costs and improves response times

### Vector Embeddings

- Each question is converted to a vector embedding
- Enables future semantic search capabilities
- Stored efficiently in PostgreSQL as JSON

### AI Integration

- Uses GPT-4.1 for high-quality question generation
- Prompts optimized for interview-style questions
- Text-embedding-3-small for efficient vector creation

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Future Enhancements

- 🔍 **Semantic Search**: Find similar questions using vector similarity
- 📊 **Analytics**: Track question usage and effectiveness
- 🎨 **Enhanced UI**: More interactive and visual question management
- 🔒 **Authentication**: User accounts and personal question libraries
- 📱 **Mobile App**: React Native companion app
- 🤝 **Question Sharing**: Community-driven question sharing

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues or have questions:

1. Check the [Issues](https://github.com/your-username/jd-vector/issues) page
2. Create a new issue with detailed information
3. Include error messages, environment details, and steps to reproduce

---

**Built with ❤️ using Next.js, OpenAI, and PostgreSQL**
