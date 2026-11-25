using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace AuraSpace;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}

internal sealed class MainForm : Form
{
    private const string VirtualHost = "auraspace.local";
    private readonly WebView2 _webView;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    public MainForm()
    {
        Text = "静界 · AuraSpace";
        BackColor = Color.FromArgb(7, 11, 24);
        MinimumSize = new Size(420, 700);
        ClientSize = new Size(1180, 780);
        StartPosition = FormStartPosition.CenterScreen;

        try
        {
            var exePath = Application.ExecutablePath;
            if (!string.IsNullOrEmpty(exePath))
            {
                Icon = Icon.ExtractAssociatedIcon(exePath);
            }
        }
        catch
        {
            // Ignore icon extraction errors
        }

        _webView = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.FromArgb(7, 11, 24),
        };
        Controls.Add(_webView);

        Load += async (_, _) => await InitializeAsync();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        EnableDarkTitleBar();
    }

    private void EnableDarkTitleBar()
    {
        try
        {
            int useDark = 1;
            if (DwmSetWindowAttribute(Handle, 20, ref useDark, sizeof(int)) != 0)
            {
                DwmSetWindowAttribute(Handle, 19, ref useDark, sizeof(int));
            }
        }
        catch
        {
            // Older Windows builds ignore DWMWA_USE_IMMERSIVE_DARK_MODE
        }
    }

    private async Task InitializeAsync()
    {
        try
        {
            var localRoot = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "AuraSpace"
            );
            var webDir = EnsureWebAssetsExtracted(Path.Combine(localRoot, "web"));
            var userDataDir = Path.Combine(localRoot, "webview2");
            Directory.CreateDirectory(userDataDir);

            var options = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required");
            var env = await CoreWebView2Environment.CreateAsync(null, userDataDir, options);
            await _webView.EnsureCoreWebView2Async(env);

            var core = _webView.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreDevToolsEnabled = false;

            core.SetVirtualHostNameToFolderMapping(
                VirtualHost,
                webDir,
                CoreWebView2HostResourceAccessKind.Allow
            );
            core.Navigate($"https://{VirtualHost}/index.html");
        }
        catch (WebView2RuntimeNotFoundException)
        {
            var result = MessageBox.Show(
                "未检测到 Microsoft Edge WebView2 运行时，是否前往微软官网免费下载安装？",
                "静界 · AuraSpace",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Information
            );
            if (result == DialogResult.Yes)
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "https://developer.microsoft.com/en-us/microsoft-edge/webview2/",
                    UseShellExecute = true,
                });
            }
            Close();
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                $"初始化界面失败：{ex.Message}",
                "静界 · AuraSpace",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            Close();
        }
    }

    private static string EnsureWebAssetsExtracted(string baseDir)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("AuraSpace.web-bundle.zip")
            ?? throw new InvalidOperationException("Embedded web bundle not found.");

        using var ms = new MemoryStream();
        stream.CopyTo(ms);
        var bytes = ms.ToArray();
        var hashHex = Convert.ToHexString(SHA256.HashData(bytes))[..12].ToLowerInvariant();
        var targetDir = Path.Combine(baseDir, hashHex);
        var entryHtml = Path.Combine(targetDir, "index.html");

        if (!File.Exists(entryHtml))
        {
            if (Directory.Exists(targetDir))
            {
                Directory.Delete(targetDir, recursive: true);
            }
            Directory.CreateDirectory(targetDir);
            ms.Position = 0;
            using var archive = new ZipArchive(ms, ZipArchiveMode.Read);
            archive.ExtractToDirectory(targetDir, overwriteFiles: true);
        }

        return targetDir;
    }
}
