#!/bin/bash
# Разворачивает структуру на новом сервере

set -e

PROJECT_DIR="/opt/kitaiservise"

mkdir -p $PROJECT_DIR/outreach/groups/group_a/messages
mkdir -p $PROJECT_DIR/outreach/groups/group_b/messages
mkdir -p $PROJECT_DIR/outreach/groups/group_c/messages
mkdir -p $PROJECT_DIR/outreach/messages
mkdir -p $PROJECT_DIR/venv

# Копируем файлы
cp *.py $PROJECT_DIR/outreach/
cp .env $PROJECT_DIR/outreach/

# Ставим зависимости
python3 -m venv $PROJECT_DIR/venv
$PROJECT_DIR/venv/bin/pip install telethon anthropic supabase

echo "Готово. Не забудь:"
echo "  1. Заполнить $PROJECT_DIR/outreach/.env"
echo "  2. Положить accounts.json в $PROJECT_DIR/outreach/"
echo "  3. Положить chats.csv в $PROJECT_DIR/"
echo "  4. Добавить сообщения в groups/group_*/messages/message.txt"
