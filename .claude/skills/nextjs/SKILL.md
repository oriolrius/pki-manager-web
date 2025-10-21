---
name: Next.js
description: Expert guidance for Next.js framework including App Router, Server Components, routing, data fetching, API routes, middleware, and deployment. Use this when building Next.js applications, working with React Server Components, or implementing Next.js features.
---

# Next.js

Expert assistance with Next.js React framework and modern web application development.

## Overview

Next.js is a React framework with:
- **App Router** (Next.js 13+): File-based routing with React Server Components
- **Pages Router** (Legacy): Traditional Next.js routing
- Server-side rendering (SSR)
- Static site generation (SSG)
- API routes
- Built-in optimization

This guide focuses on **App Router** (modern approach).

## Project Setup

### Create New Project
```bash
# Create Next.js app (interactive)
npx create-next-app@latest

# With specific options
npx create-next-app@latest my-app --typescript --tailwind --app --use-npm

# Project structure
my-app/
├── app/                 # App Router directory
│   ├── layout.tsx       # Root layout
│   ├── page.tsx         # Home page
│   ├── globals.css      # Global styles
│   └── api/             # API routes
├── public/              # Static assets
├── components/          # React components
├── lib/                 # Utility functions
└── next.config.js       # Next.js configuration
```

### Development Commands
```bash
# Start dev server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run linter
npm run lint
```

## App Router (Next.js 13+)

### File-Based Routing

**Special Files**:
- `layout.tsx` - Shared UI for a segment
- `page.tsx` - Unique UI for a route
- `loading.tsx` - Loading UI
- `error.tsx` - Error UI
- `not-found.tsx` - 404 UI
- `route.tsx` - API endpoint

**Example Structure**:
```
app/
├── layout.tsx           # Root layout
├── page.tsx             # / route
├── about/
│   └── page.tsx         # /about route
├── blog/
│   ├── layout.tsx       # Blog layout
│   ├── page.tsx         # /blog route
│   └── [slug]/
│       └── page.tsx     # /blog/:slug route
└── dashboard/
    ├── layout.tsx
    ├── page.tsx         # /dashboard route
    ├── settings/
    │   └── page.tsx     # /dashboard/settings
    └── [id]/
        └── page.tsx     # /dashboard/:id
```

### Root Layout
```typescript
// app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'My App',
  description: 'Built with Next.js',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

### Basic Page
```typescript
// app/page.tsx
export default function Home() {
  return (
    <main>
      <h1>Welcome to Next.js</h1>
      <p>This is a Server Component by default</p>
    </main>
  )
}
```

### Dynamic Routes
```typescript
// app/blog/[slug]/page.tsx
export default function BlogPost({
  params,
}: {
  params: { slug: string }
}) {
  return <h1>Blog Post: {params.slug}</h1>
}

// Generate static params for SSG
export async function generateStaticParams() {
  const posts = await getPosts()

  return posts.map((post) => ({
    slug: post.slug,
  }))
}
```

### Catch-All Routes
```typescript
// app/shop/[...slug]/page.tsx - Matches /shop/a, /shop/a/b, etc.
// app/docs/[[...slug]]/page.tsx - Optional catch-all, also matches /docs

export default function Page({
  params,
}: {
  params: { slug: string[] }
}) {
  return <div>Path: {params.slug.join('/')}</div>
}
```

### Route Groups
```typescript
// Group routes without affecting URL structure
app/
├── (marketing)/
│   ├── about/
│   │   └── page.tsx     # /about
│   └── blog/
│       └── page.tsx     # /blog
└── (shop)/
    ├── layout.tsx       # Shop layout
    ├── products/
    │   └── page.tsx     # /products
    └── cart/
        └── page.tsx     # /cart
```

## Server vs Client Components

### Server Components (Default)
```typescript
// app/posts/page.tsx
// Server Component by default - runs on server
async function getPosts() {
  const res = await fetch('https://api.example.com/posts')
  return res.json()
}

export default async function PostsPage() {
  const posts = await getPosts()

  return (
    <div>
      {posts.map((post) => (
        <article key={post.id}>
          <h2>{post.title}</h2>
        </article>
      ))}
    </div>
  )
}
```

**Benefits**:
- Access to backend resources
- Keep sensitive data on server
- Reduce client-side JavaScript
- Better performance

### Client Components
```typescript
// components/Counter.tsx
'use client'  // Required for client components

import { useState } from 'react'

export default function Counter() {
  const [count, setCount] = useState(0)

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </div>
  )
}
```

**Use when you need**:
- State (`useState`, `useReducer`)
- Effects (`useEffect`)
- Browser APIs
- Event listeners
- Custom hooks

### Composition Pattern
```typescript
// app/page.tsx (Server Component)
import ClientComponent from '@/components/ClientComponent'
import ServerComponent from '@/components/ServerComponent'

export default async function Page() {
  const data = await fetchData()

  return (
    <div>
      <ServerComponent data={data} />
      <ClientComponent />
    </div>
  )
}
```

## Data Fetching

### Server Component Data Fetching
```typescript
// app/posts/page.tsx
async function getPosts() {
  const res = await fetch('https://api.example.com/posts', {
    next: { revalidate: 3600 } // Revalidate every hour
  })

  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export default async function PostsPage() {
  const posts = await getPosts()
  return <PostsList posts={posts} />
}
```

### Caching Strategies
```typescript
// No caching (dynamic)
fetch('https://api.example.com/data', { cache: 'no-store' })

// Cache indefinitely (static)
fetch('https://api.example.com/data', { cache: 'force-cache' })

// Revalidate after time
fetch('https://api.example.com/data', {
  next: { revalidate: 60 } // 60 seconds
})

// Revalidate with tag
fetch('https://api.example.com/data', {
  next: { tags: ['posts'] }
})

// Then revalidate programmatically
import { revalidateTag } from 'next/cache'
revalidateTag('posts')
```

### Parallel Data Fetching
```typescript
export default async function Page() {
  // Initiate both requests in parallel
  const userPromise = getUser()
  const postsPromise = getPosts()

  // Wait for both
  const [user, posts] = await Promise.all([
    userPromise,
    postsPromise,
  ])

  return <Dashboard user={user} posts={posts} />
}
```

### Sequential Data Fetching
```typescript
export default async function Page() {
  // Fetch user first
  const user = await getUser()

  // Then fetch user's posts
  const posts = await getUserPosts(user.id)

  return <Profile user={user} posts={posts} />
}
```

## Loading & Error States

### Loading UI
```typescript
// app/dashboard/loading.tsx
export default function Loading() {
  return (
    <div className="flex items-center justify-center">
      <div className="animate-spin rounded-full h-32 w-32 border-b-2" />
    </div>
  )
}
```

### Error Handling
```typescript
// app/dashboard/error.tsx
'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div>
      <h2>Something went wrong!</h2>
      <p>{error.message}</p>
      <button onClick={() => reset()}>Try again</button>
    </div>
  )
}
```

### Not Found
```typescript
// app/blog/[slug]/page.tsx
import { notFound } from 'next/navigation'

export default async function BlogPost({
  params,
}: {
  params: { slug: string }
}) {
  const post = await getPost(params.slug)

  if (!post) {
    notFound()
  }

  return <article>{post.content}</article>
}

// app/blog/[slug]/not-found.tsx
export default function NotFound() {
  return <div>Blog post not found</div>
}
```

## API Routes

### Route Handlers
```typescript
// app/api/posts/route.ts
import { NextRequest, NextResponse } from 'next/server'

// GET /api/posts
export async function GET(request: NextRequest) {
  const posts = await getPosts()
  return NextResponse.json(posts)
}

// POST /api/posts
export async function POST(request: NextRequest) {
  const body = await request.json()
  const post = await createPost(body)
  return NextResponse.json(post, { status: 201 })
}
```

### Dynamic API Routes
```typescript
// app/api/posts/[id]/route.ts
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const post = await getPost(params.id)

  if (!post) {
    return NextResponse.json(
      { error: 'Post not found' },
      { status: 404 }
    )
  }

  return NextResponse.json(post)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  await deletePost(params.id)
  return NextResponse.json({ success: true })
}
```

### Request Helpers
```typescript
// app/api/search/route.ts
export async function GET(request: NextRequest) {
  // Query parameters
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get('q')

  // Headers
  const token = request.headers.get('authorization')

  // Cookies
  const session = request.cookies.get('session')

  const results = await search(query)

  // Set cookies in response
  const response = NextResponse.json(results)
  response.cookies.set('last-search', query || '', {
    httpOnly: true,
    secure: true,
    maxAge: 3600,
  })

  return response
}
```

## Middleware

```typescript
// middleware.ts (root level)
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Check authentication
  const token = request.cookies.get('token')

  if (!token && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Add custom header
  const response = NextResponse.next()
  response.headers.set('x-custom-header', 'value')

  return response
}

// Configure which routes to run middleware on
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/:path*',
  ],
}
```

## Navigation

### Link Component
```typescript
import Link from 'next/link'

export default function Nav() {
  return (
    <nav>
      <Link href="/">Home</Link>
      <Link href="/about">About</Link>
      <Link href="/blog/my-post">Blog Post</Link>

      {/* With prefetching disabled */}
      <Link href="/heavy-page" prefetch={false}>
        Heavy Page
      </Link>
    </nav>
  )
}
```

### Programmatic Navigation
```typescript
'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

export default function NavigationExample() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const handleNavigate = () => {
    router.push('/dashboard')
    // router.replace('/dashboard') // No history entry
    // router.back()
    // router.forward()
    // router.refresh() // Refresh current route
  }

  return (
    <div>
      <p>Current path: {pathname}</p>
      <p>Query param: {searchParams.get('id')}</p>
      <button onClick={handleNavigate}>Go to Dashboard</button>
    </div>
  )
}
```

## Metadata & SEO

### Static Metadata
```typescript
// app/about/page.tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'About Us',
  description: 'Learn more about our company',
  keywords: ['about', 'company', 'team'],
  openGraph: {
    title: 'About Us',
    description: 'Learn more about our company',
    images: ['/og-image.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'About Us',
    description: 'Learn more about our company',
    images: ['/twitter-image.png'],
  },
}

export default function AboutPage() {
  return <div>About Us</div>
}
```

### Dynamic Metadata
```typescript
// app/blog/[slug]/page.tsx
export async function generateMetadata({
  params,
}: {
  params: { slug: string }
}): Promise<Metadata> {
  const post = await getPost(params.slug)

  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      images: [post.coverImage],
    },
  }
}
```

## Image Optimization

```typescript
import Image from 'next/image'

export default function Gallery() {
  return (
    <div>
      {/* Local image */}
      <Image
        src="/hero.jpg"
        alt="Hero"
        width={800}
        height={600}
        priority // Load eagerly
      />

      {/* Remote image */}
      <Image
        src="https://example.com/image.jpg"
        alt="Remote"
        width={800}
        height={600}
        loading="lazy"
      />

      {/* Fill container */}
      <div className="relative h-64">
        <Image
          src="/background.jpg"
          alt="Background"
          fill
          className="object-cover"
        />
      </div>
    </div>
  )
}
```

## Environment Variables

```typescript
// .env.local
DATABASE_URL=postgresql://...
NEXT_PUBLIC_API_URL=https://api.example.com

// Server component (private vars)
const dbUrl = process.env.DATABASE_URL

// Client component (public vars only)
const apiUrl = process.env.NEXT_PUBLIC_API_URL
```

## Configuration

```javascript
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Image domains
  images: {
    domains: ['example.com', 'cdn.example.com'],
  },

  // Redirects
  async redirects() {
    return [
      {
        source: '/old-path',
        destination: '/new-path',
        permanent: true,
      },
    ]
  },

  // Rewrites
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'https://api.example.com/:path*',
      },
    ]
  },

  // Headers
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
    ]
  },

  // Environment variables
  env: {
    CUSTOM_VAR: 'value',
  },
}

module.exports = nextConfig
```

## Best Practices

### 1. Server Components by Default
```typescript
// ✅ Use Server Components when possible
// app/page.tsx
async function getData() {
  const res = await fetch('https://api.example.com/data')
  return res.json()
}

export default async function Page() {
  const data = await getData()
  return <div>{data.title}</div>
}

// ❌ Don't use Client Component unnecessarily
'use client'
export default function Page() {
  // This doesn't need to be a Client Component
  return <div>Static content</div>
}
```

### 2. Proper Data Fetching
```typescript
// ✅ Fetch in Server Components
async function Page() {
  const data = await fetch('...').then(r => r.json())
  return <List data={data} />
}

// ❌ Don't fetch in Client Components if avoidable
'use client'
function Page() {
  const [data, setData] = useState([])
  useEffect(() => {
    fetch('...').then(r => r.json()).then(setData)
  }, [])
  return <List data={data} />
}
```

### 3. Loading States
```typescript
// ✅ Use loading.tsx for automatic loading UI
// app/dashboard/loading.tsx
export default function Loading() {
  return <Skeleton />
}

// ✅ Or use Suspense for granular control
import { Suspense } from 'react'

export default function Page() {
  return (
    <Suspense fallback={<Skeleton />}>
      <DataComponent />
    </Suspense>
  )
}
```

### 4. Error Handling
```typescript
// ✅ Use error.tsx for error boundaries
// app/dashboard/error.tsx
'use client'
export default function Error({ error, reset }) {
  return (
    <div>
      <h2>Error: {error.message}</h2>
      <button onClick={reset}>Retry</button>
    </div>
  )
}
```

### 5. Metadata
```typescript
// ✅ Always add metadata for SEO
export const metadata = {
  title: 'Page Title',
  description: 'Page description',
}

// ✅ Use dynamic metadata for dynamic routes
export async function generateMetadata({ params }) {
  const data = await getData(params.id)
  return { title: data.title }
}
```

## Common Patterns

### Authentication Check
```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth-token')

  if (!token && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
}
```

### Protected API Route
```typescript
// app/api/protected/route.ts
export async function GET(request: NextRequest) {
  const token = request.headers.get('authorization')

  if (!token) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const data = await getProtectedData()
  return NextResponse.json(data)
}
```

### Form Handling
```typescript
'use client'

export default function ContactForm() {
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)

    const res = await fetch('/api/contact', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(formData)),
      headers: { 'Content-Type': 'application/json' },
    })

    if (res.ok) {
      alert('Submitted!')
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input name="email" type="email" required />
      <textarea name="message" required />
      <button type="submit">Submit</button>
    </form>
  )
}
```

## Deployment

### Vercel (Recommended)
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Production deployment
vercel --prod
```

### Docker
```dockerfile
FROM node:18-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:18-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
```

## Resources

- Docs: https://nextjs.org/docs
- App Router: https://nextjs.org/docs/app
- Examples: https://github.com/vercel/next.js/tree/canary/examples
