package hexestra.bridge;

import burp.api.montoya.BurpExtension;
import burp.api.montoya.MontoyaApi;
import burp.api.montoya.core.ByteArray;
import burp.api.montoya.http.HttpService;
import burp.api.montoya.http.message.HttpRequestResponse;
import burp.api.montoya.http.message.requests.HttpRequest;
import burp.api.montoya.http.message.responses.HttpResponse;
import burp.api.montoya.persistence.PersistedObject;

import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JTextField;
import javax.swing.SwingUtilities;
import java.awt.Component;
import java.awt.FlowLayout;
import java.awt.Font;
import java.awt.Toolkit;
import java.awt.datatransfer.StringSelection;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

public final class HexestraBurpBridge implements BurpExtension {
    private static final String VERSION = "0.1.2";
    private static final int DEFAULT_PORT = 9877;
    private static final int MAX_EXCHANGE_BYTES = 64 * 1024 * 1024;
    private static final int MAX_SEEN_FLOWS = 2_048;

    private MontoyaApi api;
    private PersistedObject settings;
    private LoopbackHttpServer server;
    private JTextField tokenField;
    private JTextField portField;
    private JCheckBox organizerCheck;
    private JLabel statusLabel;
    private JLabel countLabel;
    private volatile boolean organizerEnabled;
    private final AtomicLong imported = new AtomicLong();
    private final Map<String, Boolean> seenFlows = new LinkedHashMap<>(128, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
            return size() > MAX_SEEN_FLOWS;
        }
    };

    @Override
    public void initialize(MontoyaApi api) {
        this.api = api;
        this.settings = api.persistence().extensionData();
        api.extension().setName("Hexestra Bridge");
        ensureDefaults();
        loadSeenFlows();
        organizerEnabled = Boolean.TRUE.equals(settings.getBoolean("organizer"));
        JPanel panel = buildPanel();
        api.userInterface().applyThemeToComponent(panel);
        api.userInterface().registerSuiteTab("Hexestra Bridge", panel);
        api.extension().registerUnloadingHandler(this::stopServer);
        startServer();
    }

    private void ensureDefaults() {
        if (settings.getString("token") == null || settings.getString("token").length() < 32) {
            settings.setString("token", newToken());
        }
        Integer port = settings.getInteger("port");
        if (port == null || port < 1 || port > 65_535) settings.setInteger("port", DEFAULT_PORT);
        if (settings.getBoolean("organizer") == null) settings.setBoolean("organizer", true);
    }

    private void loadSeenFlows() {
        String persisted = settings.getString("seenFlows");
        if (persisted == null || persisted.isBlank()) return;
        synchronized (seenFlows) {
            for (String fingerprint : persisted.split("\\n")) {
                if (fingerprint.matches("[A-Za-z0-9_-]{43}")) seenFlows.put(fingerprint, Boolean.TRUE);
            }
        }
    }

    private JPanel buildPanel() {
        JPanel root = new JPanel();
        root.setLayout(new BoxLayout(root, BoxLayout.Y_AXIS));
        root.setBorder(BorderFactory.createEmptyBorder(18, 18, 18, 18));

        JLabel title = new JLabel("Hexestra Bridge " + VERSION);
        title.setFont(title.getFont().deriveFont(Font.BOLD, 18f));
        title.setAlignmentX(Component.LEFT_ALIGNMENT);
        root.add(title);
        root.add(Box.createVerticalStrut(6));

        JLabel description = new JLabel("Receives completed Hexestra exchanges on loopback and imports them without sending another target request.");
        description.setAlignmentX(Component.LEFT_ALIGNMENT);
        root.add(description);
        root.add(Box.createVerticalStrut(14));

        portField = new JTextField(String.valueOf(settings.getInteger("port")), 8);
        tokenField = new JTextField(settings.getString("token"), 48);
        tokenField.setEditable(false);
        organizerCheck = new JCheckBox("Also add mirrored exchanges to Organizer", organizerEnabled);
        organizerCheck.addActionListener(event -> {
            organizerEnabled = organizerCheck.isSelected();
            settings.setBoolean("organizer", organizerEnabled);
        });

        root.add(row("Loopback port", portField, button("Apply and restart", this::applyPort)));
        root.add(Box.createVerticalStrut(8));
        root.add(row("Pairing token", tokenField, button("Copy", this::copyToken), button("Regenerate", this::regenerateToken)));
        root.add(Box.createVerticalStrut(10));
        organizerCheck.setAlignmentX(Component.LEFT_ALIGNMENT);
        root.add(organizerCheck);
        root.add(Box.createVerticalStrut(14));

        statusLabel = new JLabel("Starting...");
        countLabel = new JLabel("Imported: 0");
        statusLabel.setAlignmentX(Component.LEFT_ALIGNMENT);
        countLabel.setAlignmentX(Component.LEFT_ALIGNMENT);
        root.add(statusLabel);
        root.add(Box.createVerticalStrut(4));
        root.add(countLabel);
        root.add(Box.createVerticalGlue());
        return root;
    }

    private JPanel row(String label, Component... components) {
        JPanel row = new JPanel(new FlowLayout(FlowLayout.LEFT, 8, 0));
        row.setAlignmentX(Component.LEFT_ALIGNMENT);
        row.add(new JLabel(label));
        for (Component component : components) row.add(component);
        return row;
    }

    private JButton button(String label, Runnable action) {
        JButton button = new JButton(label);
        button.addActionListener(event -> action.run());
        return button;
    }

    private void applyPort() {
        try {
            int port = Integer.parseInt(portField.getText().trim());
            if (port < 1 || port > 65_535) throw new NumberFormatException();
            settings.setInteger("port", port);
            restartServer();
        } catch (NumberFormatException error) {
            setStatus("Port must be between 1 and 65535.");
        }
    }

    private void copyToken() {
        Toolkit.getDefaultToolkit().getSystemClipboard().setContents(new StringSelection(settings.getString("token")), null);
        setStatus("Pairing token copied.");
    }

    private void regenerateToken() {
        settings.setString("token", newToken());
        tokenField.setText(settings.getString("token"));
        setStatus("Pairing token regenerated. Update it in Hexestra.");
    }

    private synchronized void restartServer() {
        stopServer();
        startServer();
    }

    private synchronized void startServer() {
        if (server != null) return;
        int requestedPort = settings.getInteger("port");
        try {
            LoopbackHttpServer.Binding binding = LoopbackHttpServer.bindWithFallback(requestedPort, this::handleRequest);
            server = binding.server();
            server.start();
            int actualPort = binding.actualPort();
            if (binding.usedFallback()) {
                settings.setInteger("port", actualPort);
                setPortField(actualPort);
                setStatus("Port " + requestedPort + " was busy. Listening on 127.0.0.1:" + actualPort + ". Update the Bridge port in Hexestra.");
                api.logging().logToOutput("Hexestra Bridge port " + requestedPort + " was already in use; using 127.0.0.1:" + actualPort);
            } else {
                setStatus("Listening on 127.0.0.1:" + actualPort);
                api.logging().logToOutput("Hexestra Bridge listening on 127.0.0.1:" + actualPort);
            }
        } catch (IOException error) {
            server = null;
            setStatus("Unable to open a loopback Bridge port - " + error.getMessage());
            api.logging().logToError("Hexestra Bridge failed to start", error);
        }
    }

    private synchronized void stopServer() {
        if (server != null) server.close();
        server = null;
    }

    private LoopbackHttpServer.Response handleRequest(LoopbackHttpServer.Request request) {
        if ("/v1/health".equals(request.path())) return health(request);
        if ("/v1/flows".equals(request.path())) return receiveFlow(request);
        return json(404, "{\"error\":\"Not found\"}");
    }

    private LoopbackHttpServer.Response health(LoopbackHttpServer.Request request) {
        LoopbackHttpServer.Response unauthorized = authorize(request);
        if (unauthorized != null) return unauthorized;
        if (!"GET".equals(request.method())) {
            return json(405, "{\"error\":\"Method not allowed\"}");
        }
        return json(200, "{\"product\":\"Hexestra Bridge\",\"version\":\"" + VERSION + "\",\"capabilities\":[\"site_map\",\"organizer\"]}");
    }

    private LoopbackHttpServer.Response receiveFlow(LoopbackHttpServer.Request request) {
        LoopbackHttpServer.Response unauthorized = authorize(request);
        if (unauthorized != null) return unauthorized;
        if (!"POST".equals(request.method())) return json(405, "{\"error\":\"Method not allowed\"}");
        try {
            String flowId = requiredHeader(request, "X-Hexestra-Flow-Id", 200);
            String projectId = requiredHeader(request, "X-Hexestra-Project-Id", 200);
            String scheme = requiredHeader(request, "X-Hexestra-Scheme", 8);
            if (!scheme.equals("http") && !scheme.equals("https")) throw new IllegalArgumentException("Invalid scheme");
            String host = new String(Base64.getUrlDecoder().decode(requiredHeader(request, "X-Hexestra-Host", 512)), StandardCharsets.UTF_8);
            if (host.isBlank() || host.length() > 253 || host.indexOf('\0') >= 0) throw new IllegalArgumentException("Invalid host");
            int port = boundedInt(requiredHeader(request, "X-Hexestra-Port", 5), 1, 65_535, "port");
            int requestLength = boundedInt(requiredHeader(request, "X-Hexestra-Request-Length", 12), 1, MAX_EXCHANGE_BYTES, "request length");
            int responseLength = boundedInt(requiredHeader(request, "X-Hexestra-Response-Length", 12), 1, MAX_EXCHANGE_BYTES, "response length");
            if ((long) requestLength + responseLength > MAX_EXCHANGE_BYTES) throw new IllegalArgumentException("Exchange is too large");

            String dedupeKey = fingerprint(projectId + ":" + flowId);
            byte[] body = request.body();
            if (body.length != requestLength + responseLength) throw new IllegalArgumentException("Exchange length does not match headers");
            byte[] requestBytes = Arrays.copyOfRange(body, 0, requestLength);
            byte[] responseBytes = Arrays.copyOfRange(body, requestLength, body.length);
            HttpService service = HttpService.httpService(host, port, scheme.equals("https"));
            HttpRequest httpRequest = HttpRequest.httpRequest(service, ByteArray.byteArray(requestBytes));
            HttpResponse response = HttpResponse.httpResponse(ByteArray.byteArray(responseBytes));
            HttpRequestResponse exchangeValue = HttpRequestResponse.httpRequestResponse(httpRequest, response);
            boolean organizer = false;
            synchronized (seenFlows) {
                if (seenFlows.containsKey(dedupeKey)) {
                    return json(200, "{\"accepted\":true,\"duplicate\":true,\"siteMap\":true,\"organizer\":false}");
                }
                api.siteMap().add(exchangeValue);
                if (organizerEnabled) {
                    try {
                        api.organizer().sendToOrganizer(exchangeValue);
                        organizer = true;
                    } catch (RuntimeException error) {
                        api.logging().logToError("Hexestra Bridge could not add the exchange to Organizer", error);
                    }
                }
                seenFlows.put(dedupeKey, Boolean.TRUE);
                settings.setString("seenFlows", String.join("\n", seenFlows.keySet()));
            }
            long count = imported.incrementAndGet();
            setCount(count);
            return json(200, "{\"accepted\":true,\"duplicate\":false,\"siteMap\":true,\"organizer\":" + organizer + "}");
        } catch (IllegalArgumentException error) {
            return json(400, "{\"error\":\"" + jsonEscape(error.getMessage()) + "\"}");
        } catch (RuntimeException error) {
            api.logging().logToError("Hexestra Bridge import failed", error);
            return json(500, "{\"error\":\"Burp could not import the exchange\"}");
        }
    }

    private LoopbackHttpServer.Response authorize(LoopbackHttpServer.Request request) {
        String authorization = request.header("Authorization");
        String expected = "Bearer " + settings.getString("token");
        boolean accepted = authorization != null && MessageDigest.isEqual(
                authorization.getBytes(StandardCharsets.UTF_8), expected.getBytes(StandardCharsets.UTF_8));
        return accepted ? null : json(401, "{\"error\":\"Invalid pairing token\"}");
    }

    private static String requiredHeader(LoopbackHttpServer.Request request, String name, int maxLength) {
        String value = request.header(name);
        if (value == null || value.isBlank() || value.length() > maxLength) throw new IllegalArgumentException("Missing or invalid " + name);
        return value;
    }

    private static int boundedInt(String value, int minimum, int maximum, String label) {
        try {
            int parsed = Integer.parseInt(value);
            if (parsed < minimum || parsed > maximum) throw new NumberFormatException();
            return parsed;
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("Invalid " + label);
        }
    }

    private static LoopbackHttpServer.Response json(int status, String json) {
        return LoopbackHttpServer.Response.json(status, json);
    }

    private void setStatus(String value) {
        if (statusLabel == null) return;
        SwingUtilities.invokeLater(() -> statusLabel.setText(value));
    }

    private void setCount(long value) {
        if (countLabel == null) return;
        SwingUtilities.invokeLater(() -> countLabel.setText("Imported: " + value));
    }

    private void setPortField(int value) {
        if (portField == null) return;
        SwingUtilities.invokeLater(() -> portField.setText(String.valueOf(value)));
    }

    private static String newToken() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String fingerprint(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (java.security.NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }

    private static String jsonEscape(String value) {
        if (value == null) return "Invalid request";
        return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r", " ").replace("\n", " ");
    }
}
