package hexestra.bridge;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.BindException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class LoopbackHttpServer implements AutoCloseable {
    static final int MAX_BODY_BYTES = 64 * 1024 * 1024;
    private static final int MAX_LINE_BYTES = 8 * 1024;
    private static final int MAX_HEADER_BYTES = 64 * 1024;
    private static final int MAX_HEADERS = 100;
    private static final int SOCKET_TIMEOUT_MS = 5_000;

    interface Handler {
        Response handle(Request request);
    }

    record Request(String method, String path, Map<String, String> headers, byte[] body) {
        String header(String name) {
            return headers.get(name);
        }
    }

    record Response(int status, String json) {
        static Response json(int status, String json) {
            return new Response(status, json);
        }
    }

    record Binding(LoopbackHttpServer server, int requestedPort, int actualPort) {
        boolean usedFallback() {
            return requestedPort != actualPort;
        }
    }

    private final Handler handler;
    private final ServerSocket listener;
    private final ExecutorService workers;
    private final Thread acceptThread;
    private volatile boolean closed;

    LoopbackHttpServer(int port, Handler handler) throws IOException {
        this.handler = handler;
        this.listener = new ServerSocket(port, 16, InetAddress.getByName("127.0.0.1"));
        this.workers = Executors.newFixedThreadPool(2, runnable -> daemonThread(runnable, "hexestra-bridge-worker"));
        this.acceptThread = daemonThread(this::acceptLoop, "hexestra-bridge-accept");
    }

    static Binding bindWithFallback(int requestedPort, Handler handler) throws IOException {
        try {
            LoopbackHttpServer server = new LoopbackHttpServer(requestedPort, handler);
            return new Binding(server, requestedPort, server.port());
        } catch (BindException preferredPortError) {
            try {
                LoopbackHttpServer server = new LoopbackHttpServer(0, handler);
                return new Binding(server, requestedPort, server.port());
            } catch (IOException fallbackError) {
                fallbackError.addSuppressed(preferredPortError);
                throw fallbackError;
            }
        }
    }

    void start() {
        acceptThread.start();
    }

    int port() {
        return listener.getLocalPort();
    }

    private void acceptLoop() {
        while (!closed) {
            try {
                Socket socket = listener.accept();
                workers.execute(() -> serve(socket));
            } catch (SocketException error) {
                if (!closed) error.printStackTrace(System.err);
            } catch (IOException error) {
                if (!closed) error.printStackTrace(System.err);
            }
        }
    }

    private void serve(Socket socket) {
        try (socket;
             BufferedInputStream input = new BufferedInputStream(socket.getInputStream());
             BufferedOutputStream output = new BufferedOutputStream(socket.getOutputStream())) {
            socket.setSoTimeout(SOCKET_TIMEOUT_MS);
            Response response;
            try {
                response = handler.handle(readRequest(input));
                if (response == null) response = Response.json(500, "{\"error\":\"Empty Bridge response\"}");
            } catch (ClientError error) {
                response = Response.json(error.status, "{\"error\":\"" + jsonEscape(error.getMessage()) + "\"}");
            } catch (RuntimeException error) {
                response = Response.json(500, "{\"error\":\"Bridge request failed\"}");
            }
            writeResponse(output, response);
        } catch (IOException ignored) {
            // The client may disconnect while a bounded request is being read.
        }
    }

    private static Request readRequest(BufferedInputStream input) throws IOException {
        String requestLine = readLine(input, MAX_LINE_BYTES);
        String[] parts = requestLine.split(" ", 3);
        if (parts.length != 3 || !parts[2].startsWith("HTTP/1.")) throw new ClientError(400, "Invalid HTTP request line");
        if (!parts[1].startsWith("/") || parts[1].length() > MAX_LINE_BYTES) throw new ClientError(400, "Invalid HTTP path");

        Map<String, String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        int headerBytes = requestLine.length() + 2;
        int headerCount = 0;
        while (true) {
            String line = readLine(input, MAX_LINE_BYTES);
            headerBytes += line.length() + 2;
            if (headerBytes > MAX_HEADER_BYTES) throw new ClientError(431, "HTTP headers are too large");
            if (line.isEmpty()) break;
            if (++headerCount > MAX_HEADERS) throw new ClientError(431, "Too many HTTP headers");
            int separator = line.indexOf(':');
            if (separator <= 0) throw new ClientError(400, "Invalid HTTP header");
            String name = line.substring(0, separator).trim();
            String value = line.substring(separator + 1).trim();
            if (!name.matches("[!#$%&'*+.^_`|~0-9A-Za-z-]+")) throw new ClientError(400, "Invalid HTTP header name");
            headers.merge(name, value, (left, right) -> left + "," + right);
        }

        if (headers.containsKey("Transfer-Encoding")) throw new ClientError(400, "Transfer-Encoding is not supported");
        int contentLength = parseContentLength(headers.get("Content-Length"));
        byte[] body = input.readNBytes(contentLength);
        if (body.length != contentLength) throw new ClientError(400, "Truncated HTTP request body");
        return new Request(parts[0], parts[1], Collections.unmodifiableMap(headers), body);
    }

    private static int parseContentLength(String value) {
        if (value == null || value.isBlank()) return 0;
        try {
            long parsed = Long.parseLong(value);
            if (parsed < 0 || parsed > MAX_BODY_BYTES) throw new NumberFormatException();
            return (int) parsed;
        } catch (NumberFormatException error) {
            throw new ClientError(413, "Invalid or oversized Content-Length");
        }
    }

    private static String readLine(BufferedInputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        int previous = -1;
        while (output.size() <= limit) {
            int current = input.read();
            if (current < 0) throw new ClientError(400, "Unexpected end of HTTP headers");
            if (previous == '\r' && current == '\n') {
                byte[] bytes = output.toByteArray();
                return new String(bytes, 0, Math.max(0, bytes.length - 1), StandardCharsets.ISO_8859_1);
            }
            output.write(current);
            previous = current;
        }
        throw new ClientError(431, "HTTP line is too large");
    }

    private static void writeResponse(BufferedOutputStream output, Response response) throws IOException {
        byte[] body = response.json().getBytes(StandardCharsets.UTF_8);
        String statusText = switch (response.status()) {
            case 200 -> "OK";
            case 400 -> "Bad Request";
            case 401 -> "Unauthorized";
            case 404 -> "Not Found";
            case 405 -> "Method Not Allowed";
            case 413 -> "Payload Too Large";
            case 431 -> "Request Header Fields Too Large";
            default -> "Internal Server Error";
        };
        String headers = "HTTP/1.1 " + response.status() + " " + statusText + "\r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "Connection: close\r\n\r\n";
        output.write(headers.getBytes(StandardCharsets.ISO_8859_1));
        output.write(body);
        output.flush();
    }

    @Override
    public void close() {
        closed = true;
        try {
            listener.close();
        } catch (IOException ignored) {
            // Already closed.
        }
        workers.shutdownNow();
    }

    private static Thread daemonThread(Runnable runnable, String name) {
        Thread thread = new Thread(runnable, name);
        thread.setDaemon(true);
        return thread;
    }

    private static String jsonEscape(String value) {
        if (value == null) return "Invalid request";
        return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r", " ").replace("\n", " ");
    }

    private static final class ClientError extends RuntimeException {
        private final int status;

        private ClientError(int status, String message) {
            super(message);
            this.status = status;
        }
    }
}
