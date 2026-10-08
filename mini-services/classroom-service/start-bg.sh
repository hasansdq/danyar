#!/bin/bash
cd /home/z/my-project/mini-services/classroom-service
exec bun run dev >> /home/z/my-project/mini-services/classroom-service.log 2>&1
