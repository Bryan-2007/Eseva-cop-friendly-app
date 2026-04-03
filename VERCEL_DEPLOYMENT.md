# Vercel Deployment Guide with Supabase

This guide explains how to deploy the TNPOL application to Vercel with a Supabase PostgreSQL database.

## Overview

The TNPOL app is designed to run independently of the local system:
- **Frontend**: Served by Vercel (static files + API routes)
- **Backend**: Node.js serverless functions on Vercel
- **Database**: Supabase (managed PostgreSQL)
- **File Storage**: Vercel Blob Storage
- **Sessions**: PostgreSQL-backed session store

## Prerequisites

1. **Vercel Account**: Create one at https://vercel.com
2. **Supabase Project**: Create one at https://app.supabase.com
3. **Git Repository**: Push your code to GitHub/GitLab/Bitbucket
4. **Vercel CLI** (optional): For local testing
   ```bash
   npm install -g vercel
   ```

## Step 1: Set Up Supabase Database

### 1.1 Create a Supabase Project
1. Go to https://app.supabase.com
2. Click "New Project"
3. Fill in project details:
   - Organization: Select or create
   - Project name: `tnpol` or your preferred name
   - Database password: Create a strong password
   - Region: Choose closest to your users
4. Wait for project to be created (2-3 minutes)

### 1.2 Get Connection String
1. In Supabase dashboard, go to **Settings** → **Database**
2. Under "Connection pooling", find the **Connection string**
3. Copy the URI format:
   ```
   postgresql://postgres:[PASSWORD]@[PROJECT_ID].supabase.co:5432/postgres?sslmode=require
   ```
4. Replace `[PASSWORD]` with your database password (from Step 1.1)
5. Note the `[PROJECT_ID]` - this is the part between `@` and `.supabase.co`

### 1.3 Enable Required Extensions (Optional)
Some features may require PostgreSQL extensions:
1. Go to **Settings** → **Database** → **Extensions**
2. Ensure these are available (Supabase includes them by default):
   - `uuid-ossp` - for UUID generation
   - `pgcrypto` - for cryptographic functions

## Step 2: Deploy to Vercel

### 2.1 Connect Your Repository
1. Go to https://vercel.com/new
2. Select "Import Git Repository"
3. Connect your GitHub/GitLab/Bitbucket account
4. Select the repository containing this TNPOL project
5. Click "Import"

### 2.2 Configure Environment Variables
In the Vercel deployment settings:

1. **Database Connection** (Required)
   - Key: `POSTGRES_URL`
   - Value: Your Supabase connection string from Step 1.2
   - Example: `postgresql://postgres:your_password@abc123.supabase.co:5432/postgres?sslmode=require`

2. **Session Secret** (Required)
   Generate a strong random secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   - Key: `SESSION_SECRET`
   - Value: Copy the output from above command

3. **Police Credentials** (Required)
   - Key: `POLICE_USERNAME`
   - Value: Your admin username (default: `admin`)
   - Key: `POLICE_PASSWORD`
   - Value: Your admin password (change from default!)

4. **Rewards Configuration** (Optional)
   - Key: `COMPLAINT_REWARD_AMOUNT`
   - Value: `1000` (or your preferred amount)
   - Key: `REFERRAL_REWARD_AMOUNT`
   - Value: `500` (or your preferred amount)
   - Key: `CURRENCY`
   - Value: `INR` (or your currency code)

5. **Production Mode**
   - Key: `NODE_ENV`
   - Value: `production`

### 2.3 Deploy
1. Review settings and click "Deploy"
2. Wait for deployment to complete (2-5 minutes)
3. Your app will be available at: `https://your-project-name.vercel.app`

## Step 3: Set Up File Storage in Vercel

### 3.1 Connect Vercel Blob Storage
1. In Vercel dashboard for your project
2. Go to **Settings** → **Storage**
3. Click "Create Database" → select "Vercel Blob"
4. Click "Create" and follow the prompts
5. The connection token will be automatically added to environment variables

### 3.2 Alternative: Use Local Storage
If you don't need file uploads initially, the app works without Blob storage. File uploads will fail gracefully.

## Step 4: Verify Deployment

### 4.1 Check Application Health
1. Open your app: `https://your-project-name.vercel.app`
2. You should see the login page
3. Try logging in with police credentials:
   - Username: `admin` (or your configured username)
   - Password: The password you set in Vercel environment variables

### 4.2 Check Logs
1. In Vercel dashboard, go to **Deployments**
2. Click the latest deployment
3. View logs to check for any errors

## Troubleshooting

### Database Connection Failed
**Error**: `password authentication failed for user "postgres"`

**Solutions**:
- Verify `POSTGRES_URL` is correct in Vercel environment variables
- Check Supabase dashboard → **Settings** → **Database** for the correct password
- Ensure the connection string includes `?sslmode=require`

### Timeouts or Slow Performance
**Solutions**:
- Check if Vercel Blob is properly configured for file uploads
- Verify database region is close to your users
- Check Supabase project activity in the dashboard

### Sessions Not Persisting
**Solutions**:
- Ensure `NODE_ENV` is set to `production`
- Verify database connection string is correct
- Check that the `session` table was created (check Vercel logs)

### File Upload Issues
**Solutions**:
- Verify Vercel Blob is connected
- Check file size limits (default: 1MB in server.js)
- Review Vercel function logs for upload errors

## Environment Variables Reference

| Variable | Required | Default | Production |
|----------|----------|---------|-----------|
| `POSTGRES_URL` | Yes | Local PostgreSQL | Supabase URL |
| `DATABASE_URL` | No | Same as POSTGRES_URL | Same as POSTGRES_URL |
| `SESSION_SECRET` | Yes | 'dev-change-me' | Strong random |
| `NODE_ENV` | Yes | development | production |
| `PORT` | No | 3000 | Auto by Vercel |
| `POLICE_USERNAME` | No | admin | Change in production |
| `POLICE_PASSWORD` | No | admin123 | Change in production |
| `COMPLAINT_REWARD_AMOUNT` | No | 1000 | Configurable |
| `REFERRAL_REWARD_AMOUNT` | No | 500 | Configurable |
| `CURRENCY` | No | INR | Your currency |

## Development vs Production

### Local Development
```bash
# Install dependencies
npm install

# Create .env file with local database
cp .env.local .env

# Start server (requires local PostgreSQL)
npm start
```

### Production (Vercel + Supabase)
- Set environment variables in Vercel dashboard
- Push to Git repository
- Automatic deployment triggers on push to main branch
- Database and sessions automatically use Supabase

## Advanced Configuration

### Custom Domain
1. In Vercel dashboard, go to **Settings** → **Domains**
2. Add your custom domain
3. Update DNS records as shown

### SSL/TLS
- Automatically provided by Vercel
- Supabase connections use SSL with `?sslmode=require`

### Scaling
- Vercel: Automatically scales based on traffic
- Supabase: Scales transparently, upgrade plan if needed
- Monitor usage in both dashboards

### Backups
- Supabase: Automated daily backups, keep 7 days
- Configure in Supabase dashboard → **Settings** → **Database**

## Security Considerations

1. **Never commit `.env` files** - always use Vercel environment variables
2. **Change default credentials** - update `POLICE_USERNAME` and `POLICE_PASSWORD`
3. **Use strong SESSION_SECRET** - generate with `crypto.randomBytes(32).toString('hex')`
4. **Keep dependencies updated** - Run `npm audit fix` regularly
5. **Enable 2FA** on both Vercel and Supabase accounts
6. **Monitor logs** - Check Vercel and Supabase logs for suspicious activity

## Database Migration

If you had a local database and want to migrate:

1. Export data from local PostgreSQL:
   ```bash
   pg_dump -U postgres -h localhost tnpol_db > backup.sql
   ```

2. Import to Supabase:
   - Go to Supabase dashboard → **SQL Editor**
   - Run the backup.sql file
   - Or use Supabase import tools

## Support & Resources

- **Vercel Docs**: https://vercel.com/docs
- **Supabase Docs**: https://supabase.com/docs
- **Node.js Docs**: https://nodejs.org/docs
- **Express.js**: https://expressjs.com

## Rollback Plan

If deployment fails:

1. In Vercel dashboard, go to **Deployments**
2. Find previous successful deployment
3. Click the three dots → "Redeploy"
4. Verify application works

## Next Steps

After deployment:

1. Monitor application performance in Vercel and Supabase dashboards
2. Set up error tracking (optional: Sentry, LogRocket)
3. Configure CI/CD for automatic testing
4. Plan database backups and maintenance
5. Set up email alerts for deployment failures

---

**Last Updated**: April 2026
**Tested With**: Node.js v22, Vercel v34, Supabase v1.x
