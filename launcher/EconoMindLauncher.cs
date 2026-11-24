using System;
using System.Diagnostics;
using System.IO;

internal static class EconoMindLauncher
{
    // From the project root, rebuild with PowerShell:
    // & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /out:EconoMind.exe launcher\EconoMindLauncher.cs
    private static string FindPowerShell()
    {
        string[] standardDirectories = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "PowerShell", "7"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WindowsApps")
        };
        foreach (string directory in standardDirectories)
        {
            string candidate = Path.Combine(directory, "pwsh.exe");
            if (File.Exists(candidate)) return candidate;
        }

        foreach (string entry in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            string directory = entry.Trim().Trim('"');
            if (!Path.IsPathRooted(directory)) continue;
            string candidate = Path.Combine(directory, "pwsh.exe");
            if (File.Exists(candidate)) return candidate;
        }
        throw new FileNotFoundException("找不到 PowerShell 7。请安装 PowerShell 7.4 或更高版本后重试。");
    }

    private static int Main()
    {
        try
        {
            string project = AppDomain.CurrentDomain.BaseDirectory;
            string script = Path.Combine(project, "Start-EconoMind.ps1");
            if (!File.Exists(script))
                throw new FileNotFoundException("找不到 Start-EconoMind.ps1。请将 EconoMind.exe 放在项目根目录中运行。");

            Console.WriteLine("正在启动 EconoMind，服务就绪后会自动打开浏览器…");
            var start = new ProcessStartInfo(FindPowerShell(), "-NoLogo -NoProfile -File \"" + script + "\"")
            {
                WorkingDirectory = project,
                UseShellExecute = false
            };
            using (Process process = Process.Start(start))
            {
                process.WaitForExit();
                if (process.ExitCode == 0) return 0;
                Console.Error.WriteLine("EconoMind 启动失败，请查看上方的错误信息。");
                return FinishWithError(process.ExitCode);
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return FinishWithError(1);
        }
    }

    private static int FinishWithError(int exitCode)
    {
        if (!Console.IsInputRedirected)
        {
            Console.WriteLine("按 Enter 关闭窗口。");
            Console.ReadLine();
        }
        return exitCode;
    }
}
