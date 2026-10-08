#!/bin/bash
cd /home/z/my-project/mini-services/chat-service
exec bun run dev >> /home/z/my-project/mini-services/chat-service.log 2>&1
