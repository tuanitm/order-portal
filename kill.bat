@echo off

echo ====================================
echo Kill process on port 5005
echo ====================================

call :killPort 5005

echo.
echo Finished.
pause
exit /b

:killPort
set PORT=%1

echo.
echo Checking port %PORT% ...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
    echo Found PID %%a on port %PORT%
    taskkill /F /PID %%a
)

exit /b