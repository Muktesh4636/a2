#!/bin/bash

# Script to check data in PostgreSQL database on server 72.61.254.74
# Usage: ./check_database_data.sh

echo "🔍 Checking Data in PostgreSQL Database (72.61.254.74)"
echo "======================================================"
echo ""

DB_HOST="72.61.254.74"
DB_USER="muktesh"
DB_NAME="dice_game"
DB_PASSWORD="muktesh123"

# Export password for psql
export PGPASSWORD="$DB_PASSWORD"

echo "📊 Database Connection Test:"
echo "----------------------------"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT version();" 2>&1 | head -3
echo ""

echo "📋 All Tables in Database:"
echo "-------------------------"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "\dt" 2>&1
echo ""

echo "👥 Users Count:"
echo "--------------"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT COUNT(*) as total_users FROM accounts_user;" 2>&1
echo ""

echo "💰 Payment Methods:"
echo "-------------------"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT id, name, method_type, is_active, created_at FROM accounts_paymentmethod ORDER BY id DESC;" 2>&1
echo ""

echo "🎲 Game Rounds:"
echo "--------------"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT COUNT(*) as total_rounds FROM game_gameround;" 2>&1
echo ""

echo "🎯 Bets:"
echo "--------"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT COUNT(*) as total_bets FROM game_bet;" 2>&1
echo ""

echo "💵 Wallets:"
echo "-----------"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT COUNT(*) as total_wallets, SUM(balance) as total_balance FROM accounts_wallet;" 2>&1
echo ""

echo "📥 Deposit Requests:"
echo "-------------------"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT COUNT(*) as total_deposits, COUNT(CASE WHEN status='PENDING' THEN 1 END) as pending FROM accounts_depositrequest;" 2>&1
echo ""

echo "📤 Withdraw Requests:"
echo "--------------------"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT COUNT(*) as total_withdraws, COUNT(CASE WHEN status='PENDING' THEN 1 END) as pending FROM accounts_withdrawrequest;" 2>&1
echo ""

echo "💾 Database Size:"
echo "----------------"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT pg_size_pretty(pg_database_size('dice_game')) as database_size;" 2>&1
echo ""

echo "✅ Data check complete!"
unset PGPASSWORD
