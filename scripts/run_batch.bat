@echo off
REM Set your API key as an environment variable before running this script
REM set AGNES_API_KEY=your_key_here
cd /d "d:\FeiYiGuZhen\FeiYiGuZhen"
python scripts\batch_generate_assets.py > assets\images\_batch_stdout.log 2>&1
echo DONE >> assets\images\_batch_stdout.log
