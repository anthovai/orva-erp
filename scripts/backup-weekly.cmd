@echo off
cd /d "D:\Model Business\orva-erp"
"C:\Program Files\nodejs\node.exe" scripts\backup-db.mjs >> "C:\Users\aidev\orva-backups\logs\backup.log" 2>&1
echo [%date% %time%] exit=%ERRORLEVEL% >> "C:\Users\aidev\orva-backups\logs\backup.log"