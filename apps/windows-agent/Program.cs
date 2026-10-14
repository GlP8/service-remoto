using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace ServiceRemotoAgent
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            AgentCredentials credentials = null;
            try
            {
                credentials = AgentSettings.Load();
            }
            catch (Exception error)
            {
                Notify("No se pudo leer la sesion local del agente: " + error.Message, MessageBoxIcon.Warning);
                AgentSettings.Delete();
            }

            bool sessionValid = false;
            if (credentials != null && !String.IsNullOrEmpty(credentials.Token) && !String.IsNullOrEmpty(credentials.ApiUrl))
            {
                try
                {
                    AgentApi.Get(credentials, "/tickets").GetAwaiter().GetResult();
                    sessionValid = true;
                }
                catch (SessionExpiredException error)
                {
                    Notify(error.Message, MessageBoxIcon.Information);
                    AgentSettings.Delete();
                }
                catch (Exception error)
                {
                    Notify(
                        "No se pudo validar la sesion guardada. Revisa tu conexion e intenta de nuevo. Detalle: " + error.Message,
                        MessageBoxIcon.Information);
                    return;
                }
            }

            if (!sessionValid)
            {
                LoginForm login = new LoginForm(credentials == null ? null : credentials.ApiUrl);
                if (login.ShowDialog() != DialogResult.OK) return;
                credentials = login.Credentials;
                try
                {
                    AgentSettings.Save(credentials);
                }
                catch (Exception error)
                {
                    Notify("No se pudo guardar la sesion cifrada del agente: " + error.Message, MessageBoxIcon.Error);
                    return;
                }
            }

            Application.Run(new AgentForm(credentials));
        }

        public static void Notify(string message, MessageBoxIcon icon)
        {
            MessageBox.Show(message, "Agente de Service Remoto", MessageBoxButtons.OK, icon);
        }
    }

    internal static class AgentSettings
    {
        private static readonly string SettingsPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ServiceRemoto",
            "agent-session.bin");

        public static AgentCredentials Load()
        {
            if (!File.Exists(SettingsPath)) return null;
            byte[] encrypted = File.ReadAllBytes(SettingsPath);
            byte[] clear;
            try
            {
                clear = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
            }
            catch (CryptographicException error)
            {
                throw new InvalidOperationException("No se pudo descifrar la sesion local del agente.", error);
            }
            Dictionary<string, object> values = AgentApi.ParseObject(Encoding.UTF8.GetString(clear));
            return new AgentCredentials(values["apiUrl"] as string, values["token"] as string);
        }

        public static void Save(AgentCredentials credentials)
        {
            string directory = Path.GetDirectoryName(SettingsPath);
            Directory.CreateDirectory(directory);
            string json = AgentApi.ToJson(new { apiUrl = credentials.ApiUrl, token = credentials.Token });
            byte[] encrypted = ProtectedData.Protect(
                Encoding.UTF8.GetBytes(json),
                null,
                DataProtectionScope.CurrentUser);
            File.WriteAllBytes(SettingsPath, encrypted);
        }

        public static void Delete()
        {
            if (File.Exists(SettingsPath)) File.Delete(SettingsPath);
        }
    }

    internal static class AgentApi
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        // One client for the process lifetime so connections and TLS sessions are reused.
        private static readonly HttpClient Http = new HttpClient();

        public static Dictionary<string, object> ParseObject(string json)
        {
            return Json.Deserialize<Dictionary<string, object>>(json);
        }

        public static string ToJson(object value)
        {
            return Json.Serialize(value);
        }

        public static string NormalizeApiUrl(string value)
        {
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri))
                throw new InvalidOperationException("La URL de la API no es valida.");
            if (uri.Scheme != Uri.UriSchemeHttps &&
                !(uri.IsLoopback && uri.Scheme == Uri.UriSchemeHttp))
                throw new InvalidOperationException("La API debe usar HTTPS fuera de este equipo.");
            if (uri.AbsolutePath != "/" || !String.IsNullOrEmpty(uri.Query) || !String.IsNullOrEmpty(uri.Fragment))
                throw new InvalidOperationException("Escribe solo el origen de la API, sin rutas.");
            return uri.GetLeftPart(UriPartial.Authority);
        }

        public static async Task<Dictionary<string, object>> Login(string apiUrl, string email, string password)
        {
            string body = ToJson(new { email = email, password = password });
            using (HttpResponseMessage response = await Http.PostAsync(
                apiUrl + "/auth/login",
                new StringContent(body, Encoding.UTF8, "application/json")))
            {
                string content = await response.Content.ReadAsStringAsync();
                if (!response.IsSuccessStatusCode)
                    throw new InvalidOperationException(ReadApiError(content, "No se pudo iniciar sesion."));
                return ParseObject(content);
            }
        }

        public static Task Post(AgentCredentials credentials, string path)
        {
            return Send(HttpMethod.Post, credentials, path);
        }

        public static Task Get(AgentCredentials credentials, string path)
        {
            return Send(HttpMethod.Get, credentials, path);
        }

        private static async Task Send(HttpMethod method, AgentCredentials credentials, string path)
        {
            using (HttpRequestMessage request = new HttpRequestMessage(method, credentials.ApiUrl + path))
            {
                request.Headers.Authorization =
                    new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", credentials.Token);
                if (method == HttpMethod.Post)
                    request.Content = new StringContent("{}", Encoding.UTF8, "application/json");
                using (HttpResponseMessage response = await Http.SendAsync(request))
                {
                    if (response.StatusCode == HttpStatusCode.Unauthorized)
                        throw new SessionExpiredException();
                    if (!response.IsSuccessStatusCode)
                    {
                        string content = await response.Content.ReadAsStringAsync();
                        throw new ApiException(
                            response.StatusCode,
                            ReadApiError(content, "La API respondio con el estado " + (int)response.StatusCode + "."));
                    }
                }
            }
        }

        private static string ReadApiError(string json, string fallback)
        {
            try
            {
                Dictionary<string, object> body = ParseObject(json);
                if (body.ContainsKey("error") && body["error"] is string) return (string)body["error"];
            }
            catch (ArgumentException)
            {
            }
            catch (InvalidOperationException)
            {
            }
            return fallback;
        }

        public static Uri WebSocketUri(string apiUrl)
        {
            UriBuilder uri = new UriBuilder(apiUrl);
            uri.Scheme = uri.Scheme == Uri.UriSchemeHttps ? "wss" : "ws";
            uri.Path = "/ws/agent";
            return uri.Uri;
        }
    }

    internal sealed class AgentCredentials
    {
        public readonly string ApiUrl;
        public readonly string Token;

        public AgentCredentials(string apiUrl, string token)
        {
            ApiUrl = apiUrl;
            Token = token;
        }
    }

    internal sealed class ApiException : InvalidOperationException
    {
        public readonly HttpStatusCode StatusCode;

        public ApiException(HttpStatusCode statusCode, string message)
            : base(message)
        {
            StatusCode = statusCode;
        }
    }

    internal sealed class SessionExpiredException : Exception
    {
        public SessionExpiredException()
            : base("La sesion del agente vencio; inicia sesion nuevamente.")
        {
        }
    }

    internal sealed class LoginForm : Form
    {
        private readonly TextBox _apiUrl = new TextBox();
        private readonly TextBox _email = new TextBox();
        private readonly TextBox _password = new TextBox();
        private readonly Label _error = new Label();
        private readonly Button _login = new Button();

        public AgentCredentials Credentials;

        public LoginForm(string previousApiUrl)
        {
            Text = "Service Remoto - Agente";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ClientSize = new System.Drawing.Size(390, 300);

            Label heading = new Label { Text = "Agente de asistencia remota", Left = 24, Top = 18, Width = 340, Height = 30 };
            Label guidance = new Label
            {
                Text = "Inicia sesion con tu cuenta de cliente. Tu contrasena no se guarda.",
                Left = 24,
                Top = 52,
                Width = 340,
                Height = 36
            };
            AddField("Origen de la API", _apiUrl, 98);
            AddField("Correo", _email, 148);
            AddField("Contrasena", _password, 198);
            _password.UseSystemPasswordChar = true;
            _apiUrl.Text = previousApiUrl ?? "https://api.example.com";
            _error.SetBounds(24, 232, 340, 30);
            _error.ForeColor = System.Drawing.Color.DarkRed;
            _login.Text = "Iniciar sesion";
            _login.SetBounds(236, 262, 128, 28);
            _login.Click += async delegate { await SignIn(); };
            Controls.Add(heading);
            Controls.Add(guidance);
            Controls.Add(_error);
            Controls.Add(_login);
            AcceptButton = _login;
        }

        private void AddField(string label, TextBox box, int top)
        {
            Label caption = new Label { Text = label, Left = 24, Top = top, Width = 110 };
            box.SetBounds(138, top - 3, 226, 24);
            Controls.Add(caption);
            Controls.Add(box);
        }

        private async Task SignIn()
        {
            _login.Enabled = false;
            _error.Text = "";
            try
            {
                string apiUrl = AgentApi.NormalizeApiUrl(_apiUrl.Text.Trim());
                Dictionary<string, object> result = await AgentApi.Login(apiUrl, _email.Text.Trim(), _password.Text);
                Dictionary<string, object> user = result["user"] as Dictionary<string, object>;
                if (user == null || !String.Equals(user["role"] as string, "CLIENT", StringComparison.Ordinal))
                    throw new InvalidOperationException("El agente requiere una cuenta de cliente.");
                string token = result["token"] as string;
                if (String.IsNullOrEmpty(token))
                    throw new InvalidOperationException("La API no devolvio una sesion valida.");
                Credentials = new AgentCredentials(apiUrl, token);
                DialogResult = DialogResult.OK;
                Close();
            }
            catch (Exception error)
            {
                _error.Text = error.Message;
            }
            finally
            {
                _login.Enabled = true;
            }
        }
    }

    internal sealed class AgentForm : Form
    {
        // Replaced as a whole on reauthentication so the socket thread never sees a mismatched pair.
        private volatile AgentCredentials _credentials;
        private readonly CancellationTokenSource _shutdown = new CancellationTokenSource();
        private readonly Label _status = new Label();
        private readonly Label _details = new Label();
        private readonly Button _approve = new Button();
        private readonly Button _decline = new Button();
        private readonly Button _end = new Button();
        private readonly Button _confirmEnded = new Button();
        private readonly Button _logout = new Button();
        private int _ticketId;
        private bool _approved;
        private bool _serverClosed;
        private bool _localClosed;
        private bool _closingAllowed;
        private bool _reauthenticating;
        private bool _reauthenticationDismissed;

        private const string IdleDetails =
            "Esta ventana no habilita acceso desatendido. RustDesk debe pedir confirmacion en este equipo.";

        public AgentForm(AgentCredentials credentials)
        {
            _credentials = credentials;
            Text = "Service Remoto - Agente local";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ClientSize = new System.Drawing.Size(470, 250);

            Label title = new Label
            {
                Text = "AGENTE LOCAL DE SERVICE REMOTO",
                Left = 22,
                Top = 18,
                Width = 420,
                Height = 24,
                Font = new System.Drawing.Font("Segoe UI", 11, System.Drawing.FontStyle.Bold)
            };
            _status.SetBounds(22, 55, 420, 44);
            _status.Text = "Conectando con el servicio...";
            _details.SetBounds(22, 98, 420, 52);
            _details.Text = IdleDetails;

            _approve.Text = "Permitir y abrir RustDesk";
            _approve.SetBounds(22, 166, 190, 34);
            _approve.Enabled = false;
            _approve.Click += delegate { Approve(); };

            _decline.Text = "Rechazar";
            _decline.SetBounds(222, 166, 100, 34);
            _decline.Enabled = false;
            _decline.Click += async delegate { await Decline(); };

            _end.Text = "Cerrar conexion";
            _end.SetBounds(22, 210, 160, 30);
            _end.BackColor = System.Drawing.Color.Firebrick;
            _end.ForeColor = System.Drawing.Color.White;
            _end.Enabled = false;
            _end.Click += async delegate { await EndSession(); };

            _confirmEnded.Text = "Ya la cerre en RustDesk";
            _confirmEnded.SetBounds(192, 210, 150, 30);
            _confirmEnded.Enabled = false;
            _confirmEnded.Click += async delegate { await ConfirmManualClose(); };

            _logout.Text = "Cerrar agente";
            _logout.SetBounds(362, 210, 80, 30);
            _logout.Click += delegate { _closingAllowed = true; Close(); };

            Controls.Add(title);
            Controls.Add(_status);
            Controls.Add(_details);
            Controls.Add(_approve);
            Controls.Add(_decline);
            Controls.Add(_end);
            Controls.Add(_confirmEnded);
            Controls.Add(_logout);
            FormClosing += OnFormClosing;
            Shown += delegate { Task.Run(() => ListenForRequests(_shutdown.Token)); };
        }

        private void OnFormClosing(object sender, FormClosingEventArgs eventArgs)
        {
            bool systemClosing = eventArgs.CloseReason == CloseReason.WindowsShutDown ||
                eventArgs.CloseReason == CloseReason.TaskManagerClosing;
            if (!_closingAllowed && !systemClosing && (_ticketId != 0))
            {
                eventArgs.Cancel = true;
                Program.Notify(
                    "Finaliza o rechaza la solicitud antes de cerrar el agente. RustDesk podria seguir activo.",
                    MessageBoxIcon.Warning);
                return;
            }
            _shutdown.Cancel();
        }

        private async Task ListenForRequests(CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                Exception connectionError = null;
                try
                {
                    AgentCredentials credentials = _credentials;
                    using (ClientWebSocket socket = new ClientWebSocket())
                    {
                        socket.Options.SetRequestHeader("Authorization", "Bearer " + credentials.Token);
                        await socket.ConnectAsync(AgentApi.WebSocketUri(credentials.ApiUrl), cancellationToken);
                        SetConnectionStatus("Conectado. Esperando una solicitud de soporte.");
                        byte[] buffer = new byte[8192];
                        while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
                        {
                            using (MemoryStream message = new MemoryStream())
                            {
                                WebSocketReceiveResult received;
                                do
                                {
                                    received = await socket.ReceiveAsync(
                                        new ArraySegment<byte>(buffer),
                                        cancellationToken);
                                    if (received.MessageType == WebSocketMessageType.Close) break;
                                    message.Write(buffer, 0, received.Count);
                                }
                                while (!received.EndOfMessage);

                                if (received.MessageType == WebSocketMessageType.Close) break;
                                string json = Encoding.UTF8.GetString(message.ToArray());
                                PostToUi(new Action<string>(HandleMessage), json);
                            }
                        }
                    }
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception error)
                {
                    connectionError = error;
                }

                if (connectionError != null)
                    await HandleConnectionFailure(connectionError);

                try
                {
                    await Task.Delay(3000, cancellationToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }

        private async Task HandleConnectionFailure(Exception connectionError)
        {
            AgentCredentials credentials = _credentials;
            try
            {
                await AgentApi.Get(credentials, "/tickets");
                SetConnectionStatus("Sin conexion WebSocket con la API: " + connectionError.Message);
            }
            catch (SessionExpiredException)
            {
                RequestReauthentication();
            }
            catch (Exception apiError)
            {
                SetConnectionStatus("Sin conexion con la API: " + apiError.Message);
            }
        }

        private void HandleMessage(string json)
        {
            Dictionary<string, object> message;
            try
            {
                message = AgentApi.ParseObject(json);
            }
            catch (ArgumentException)
            {
                return;
            }
            if (message == null) return;

            string type = GetValue<string>(message, "type");
            if (type == "connection.requested")
            {
                Dictionary<string, object> request = GetValue<Dictionary<string, object>>(message, "request");
                if (request == null) return;
                int ticketId;
                int technicianId;
                string rustdeskId = GetValue<string>(request, "rustdeskId");
                string technicianName = GetValue<string>(request, "technicianName");
                if (!TryGetInt(request, "ticketId", out ticketId) ||
                    !TryGetInt(request, "technicianId", out technicianId) ||
                    ticketId <= 0 || technicianId <= 0 ||
                    String.IsNullOrEmpty(rustdeskId) ||
                    !System.Text.RegularExpressions.Regex.IsMatch(rustdeskId, "^[A-Za-z0-9_-]{3,64}$"))
                    return;
                ShowRequest(ticketId, technicianName ?? "Tecnico de soporte", rustdeskId);
                return;
            }

            if (type == "ticket.updated")
            {
                Dictionary<string, object> ticket = GetValue<Dictionary<string, object>>(message, "ticket");
                int ticketId;
                if (ticket != null && TryGetInt(ticket, "id", out ticketId) &&
                    ticketId == _ticketId &&
                    String.Equals(GetValue<string>(ticket, "status"), "CLOSED", StringComparison.Ordinal))
                {
                    if (_approved)
                    {
                        _serverClosed = true;
                        if (_localClosed)
                            ResetTicket("La solicitud termino y RustDesk se cerro localmente.");
                        else
                            SetServerClosedStatus();
                    }
                    else
                    {
                        ResetTicket("La solicitud termino. Si RustDesk muestra una ventana de acceso, rechazala tambien alli.");
                    }
                }
            }
        }

        private static T GetValue<T>(Dictionary<string, object> values, string key) where T : class
        {
            object value;
            return values.TryGetValue(key, out value) ? value as T : null;
        }

        private static bool TryGetInt(Dictionary<string, object> values, string key, out int result)
        {
            result = 0;
            if (!values.ContainsKey(key)) return false;
            try
            {
                result = Convert.ToInt32(values[key]);
                return true;
            }
            catch (FormatException) { return false; }
            catch (InvalidCastException) { return false; }
            catch (OverflowException) { return false; }
        }

        private void ShowRequest(int ticketId, string technicianName, string rustdeskId)
        {
            if (InvokeRequired)
            {
                PostToUi(new Action<int, string, string>(ShowRequest), ticketId, technicianName, rustdeskId);
                return;
            }
            if (_ticketId == ticketId) return;
            if (_ticketId != 0)
            {
                DeclineConcurrentRequest(ticketId);
                return;
            }
            _ticketId = ticketId;
            _approved = false;
            _serverClosed = false;
            _localClosed = false;
            _status.Text = "El tecnico " + technicianName + " solicita acceso a su equipo.";
            _details.Text = "Solicitud #" + ticketId + " | ID RustDesk " + rustdeskId +
                Environment.NewLine + "Permitir aqui no sustituye la confirmacion nativa de RustDesk.";
            _approve.Enabled = true;
            _decline.Enabled = true;
            _end.Enabled = false;
            _logout.Enabled = false;
            TopMost = true;
            WindowState = FormWindowState.Normal;
            Show();
            Activate();
        }

        private async void DeclineConcurrentRequest(int ticketId)
        {
            AgentCredentials credentials = _credentials;
            try
            {
                await AgentApi.Post(credentials, "/tickets/" + ticketId + "/decline");
            }
            catch (SessionExpiredException)
            {
                RequestReauthentication();
            }
            catch (Exception)
            {
                // The active request keeps priority; the technician sees the ticket stay open and can retry.
            }
        }

        private void Approve()
        {
            if (_ticketId == 0 || _approved) return;
            _approve.Enabled = false;
            _decline.Enabled = false;
            _status.Text = "Permiso concedido. Confirme la sesion en RustDesk.";
            _details.Text = "No se concede acceso desatendido. Si RustDesk pide confirmacion, revisa y acepta solo si reconoces al tecnico.";
            try
            {
                string executable = FindRustDesk();
                if (executable != null)
                    Process.Start(new ProcessStartInfo { FileName = executable, UseShellExecute = true });
                else
                    MessageBox.Show(
                        "No se encontro RustDesk. Abre la aplicacion oficial manualmente y revisa su solicitud de confirmacion.",
                        "RustDesk no encontrado",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information);
                _approved = true;
                _end.Enabled = true;
            }
            catch (Exception error)
            {
                _status.Text = "No se pudo abrir RustDesk: " + error.Message;
                _approve.Enabled = true;
                _decline.Enabled = true;
            }
        }

        private async Task Decline()
        {
            if (_ticketId == 0) return;
            int ticketId = _ticketId;
            _approve.Enabled = false;
            _decline.Enabled = false;
            try
            {
                AgentCredentials credentials = _credentials;
                await AgentApi.Post(credentials, "/tickets/" + ticketId + "/decline");
                ResetTicket("Solicitud rechazada. Si RustDesk muestra una ventana de acceso, rechazala tambien alli.");
            }
            catch (Exception error)
            {
                _status.Text = "No se pudo registrar el rechazo: " + error.Message;
                _approve.Enabled = true;
                _decline.Enabled = true;
                if (error is SessionExpiredException)
                {
                    _reauthenticationDismissed = false;
                    RequestReauthentication();
                }
            }
        }

        private async Task EndSession()
        {
            if (_ticketId == 0) return;
            _end.Enabled = false;
            _reauthenticationDismissed = false;
            if (!_localClosed)
            {
                DialogResult confirmation = MessageBox.Show(
                    "Esto intentara terminar todas las instancias de RustDesk abiertas en esta sesion de Windows. Deseas continuar?",
                    "Cerrar asistencia remota",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
                if (confirmation != DialogResult.Yes)
                {
                    _end.Enabled = true;
                    return;
                }

                List<string> failures = StopRustDeskProcesses();
                if (failures.Count > 0)
                {
                    _status.Text = "No se confirma el cierre local de RustDesk.";
                    _details.Text = String.Join("; ", failures) + Environment.NewLine +
                        "Cierra RustDesk manualmente y confirma abajo, o reintenta.";
                    _end.Enabled = true;
                    _confirmEnded.Enabled = true;
                    return;
                }
                _localClosed = true;
            }

            await FinishTicketClose();
        }

        private async Task ConfirmManualClose()
        {
            if (_ticketId == 0) return;
            DialogResult confirmation = MessageBox.Show(
                "Confirma que ya terminaste la sesion desde RustDesk en este equipo.",
                "Confirmar cierre local",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning);
            if (confirmation != DialogResult.Yes) return;

            _localClosed = true;
            _confirmEnded.Enabled = false;
            await FinishTicketClose();
        }

        private async Task FinishTicketClose()
        {
            if (_ticketId == 0) return;
            int ticketId = _ticketId;
            _end.Text = "Reintentar registro";
            _end.Enabled = false;
            try
            {
                AgentCredentials credentials = _credentials;
                if (!_serverClosed)
                    await AgentApi.Post(credentials, "/tickets/" + ticketId + "/disconnect");
                ResetTicket("RustDesk se cerro localmente y el ticket termino.");
            }
            catch (Exception error)
            {
                ApiException apiError = error as ApiException;
                if (apiError != null && apiError.StatusCode == HttpStatusCode.Conflict)
                {
                    ResetTicket("La solicitud ya habia terminado y RustDesk se cerro localmente.");
                    return;
                }
                if (error is SessionExpiredException)
                {
                    _status.Text = "La sesion vencio. Inicia sesion para registrar el cierre.";
                    _details.Text = "RustDesk se cerro localmente. El agente mantendra visible el aviso hasta registrar el ticket.";
                    _end.Enabled = true;
                    _reauthenticationDismissed = false;
                    RequestReauthentication();
                    return;
                }
                _status.Text = "RustDesk se cerro localmente, pero la API no registro el cierre: " + error.Message;
                _details.Text = "Mantendremos el aviso visible. Reintenta cuando vuelva la conexion.";
                _end.Enabled = true;
            }
        }

        private static List<string> StopRustDeskProcesses()
        {
            List<string> failures = new List<string>();
            int currentSessionId;
            using (Process current = Process.GetCurrentProcess())
                currentSessionId = current.SessionId;
            Process[] processes = Process.GetProcessesByName("rustdesk");
            bool foundCurrentSessionProcess = false;
            foreach (Process process in processes)
            {
                try
                {
                    if (process.SessionId != currentSessionId) continue;
                    foundCurrentSessionProcess = true;
                    process.Kill();
                    if (!process.WaitForExit(3000)) failures.Add("un proceso no termino a tiempo");
                }
                catch (Exception error)
                {
                    failures.Add(error.Message);
                }
                finally
                {
                    process.Dispose();
                }
            }
            if (!foundCurrentSessionProcess)
                failures.Add("No se encontro un proceso RustDesk en esta sesion de Windows; un servicio puede seguir ejecutandose.");
            return failures;
        }

        private static string FindRustDesk()
        {
            List<string> candidates = new List<string>();
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            candidates.Add(Path.Combine(programFiles, "RustDesk", "rustdesk.exe"));
            candidates.Add(Path.Combine(programFilesX86, "RustDesk", "rustdesk.exe"));
            candidates.Add(Path.Combine(localAppData, "Programs", "RustDesk", "rustdesk.exe"));
            foreach (string candidate in candidates)
                if (File.Exists(candidate)) return candidate;
            return null;
        }

        // Background threads post here; once the window is gone there is nothing left to update.
        private void PostToUi(Delegate method, params object[] args)
        {
            if (IsDisposed || !IsHandleCreated) return;
            try
            {
                BeginInvoke(method, args);
            }
            catch (InvalidOperationException)
            {
            }
        }

        private void SetConnectionStatus(string message)
        {
            if (InvokeRequired)
            {
                PostToUi(new Action<string>(SetConnectionStatus), message);
                return;
            }
            if (_ticketId == 0) _status.Text = message;
        }

        private void RequestReauthentication()
        {
            if (InvokeRequired)
            {
                PostToUi(new Action(RequestReauthentication));
                return;
            }
            if (_reauthenticating || _reauthenticationDismissed) return;
            _reauthenticating = true;
            TopMost = false;
            _status.Text = "La sesion vencio. Inicia sesion nuevamente para recibir solicitudes.";
            try
            {
                using (LoginForm login = new LoginForm(_credentials.ApiUrl))
                {
                    if (login.ShowDialog(this) != DialogResult.OK)
                    {
                        _reauthenticationDismissed = true;
                        _status.Text = "Sesion vencida. Usa el boton de cierre local y reintenta el registro despues de iniciar sesion.";
                        TopMost = _ticketId != 0;
                        return;
                    }
                    AgentSettings.Save(login.Credentials);
                    _credentials = login.Credentials;
                    _reauthenticationDismissed = false;
                    _status.Text = _ticketId == 0
                        ? "Sesion renovada. Reconectando..."
                        : "Sesion renovada. Reintenta registrar el cierre cuando RustDesk este terminado.";
                    TopMost = _ticketId != 0;
                }
            }
            catch (Exception error)
            {
                Program.Notify("No se pudo renovar la sesion del agente: " + error.Message, MessageBoxIcon.Error);
            }
            finally
            {
                _reauthenticating = false;
            }
        }

        private void ResetTicket(string message)
        {
            if (InvokeRequired)
            {
                PostToUi(new Action<string>(ResetTicket), message);
                return;
            }
            _ticketId = 0;
            _approved = false;
            _serverClosed = false;
            _localClosed = false;
            _status.Text = message;
            _details.Text = IdleDetails;
            _approve.Enabled = false;
            _decline.Enabled = false;
            _end.Enabled = false;
            _end.Text = "Cerrar conexion";
            _confirmEnded.Enabled = false;
            _logout.Enabled = true;
            TopMost = false;
        }

        private void SetServerClosedStatus()
        {
            if (InvokeRequired)
            {
                PostToUi(new Action(SetServerClosedStatus));
                return;
            }
            _status.Text = "El ticket termino. RustDesk podria seguir activo en este equipo.";
            _details.Text = "Usa Cerrar conexion para intentar terminar todos los procesos RustDesk de esta sesion de Windows.";
            _approve.Enabled = false;
            _decline.Enabled = false;
            _end.Text = _localClosed ? "Reintentar registro" : "Cerrar conexion";
            _end.Enabled = !_localClosed;
            _confirmEnded.Enabled = !_localClosed;
            _logout.Enabled = false;
            TopMost = true;
            WindowState = FormWindowState.Normal;
            Activate();
        }
    }
}
