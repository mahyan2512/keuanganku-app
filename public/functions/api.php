<?php
// --- KONFIGURASI DATABASE ---
$host = "sql309.infinityfree.com";
$user = "if0_41962097";
$pass = "Ragna751013";
$db = "if0_41962097_keuanganku";

$conn = new mysqli($host, $user, $pass, $db);
if ($conn->connect_error) {
    die(json_encode(["error" => "Koneksi Gagal: " . $conn->connect_error]));
}

header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE");
header("Access-Control-Allow-Headers: Content-Type");

$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);
$mode = isset($_GET['mode']) ? $_GET['mode'] : 'transaction';

// === 1. GET DATA ===
if ($method == 'GET') {
    if ($mode == 'investment') {
        // Data Portofolio Utama
        $sql = "SELECT *, (current_amount - initial_amount) as profit FROM investments ORDER BY current_amount DESC";
        $result = $conn->query($sql);
        $rows = [];
        while ($row = $result->fetch_assoc()) {
            $rows[] = $row;
        }
        echo json_encode($rows);
    } elseif ($mode == 'history') {
        // Data Riwayat untuk Grafik Garis
        $sql = "SELECT name, amount, DATE_FORMAT(date, '%Y-%m-%d %H:%i') as date_label FROM investment_history ORDER BY date ASC";
        $result = $conn->query($sql);
        $rows = [];
        while ($row = $result->fetch_assoc()) {
            $rows[] = $row;
        }
        echo json_encode($rows);
    } else {
        // Data Transaksi Arus Kas
        $month = isset($_GET['month']) ? $_GET['month'] : '';
        $sql = "SELECT * FROM transactions";
        if ($month) {
            $sql .= " WHERE DATE_FORMAT(date, '%Y-%m') = '$month'";
        }
        $sql .= " ORDER BY date DESC, created_at DESC";
        $result = $conn->query($sql);
        $rows = [];
        while ($row = $result->fetch_assoc()) {
            $rows[] = $row;
        }
        echo json_encode($rows);
    }
}

// === 2. POST DATA (TAMBAH) ===
elseif ($method == 'POST') {
    if ($mode == 'investment') {
        // Simpan Data Aset
        $stmt = $conn->prepare("INSERT INTO investments (type, name, initial_amount, current_amount, last_updated) VALUES (?, ?, ?, ?, NOW())");
        $stmt->bind_param("ssdd", $input['type'], $input['name'], $input['initial_amount'], $input['current_amount']);

        if ($stmt->execute()) {
            $last_id = $conn->insert_id;
            // AUTO LOG HISTORY
            $hist = $conn->prepare("INSERT INTO investment_history (investment_id, name, amount, date) VALUES (?, ?, ?, NOW())");
            $hist->bind_param("isd", $last_id, $input['name'], $input['current_amount']);
            $hist->execute();

            echo json_encode(["message" => "Berhasil disimpan", "id" => $last_id]);
        } else {
            http_response_code(500);
            echo json_encode(["error" => $stmt->error]);
        }
    } else {
        // Simpan Transaksi Biasa
        $stmt = $conn->prepare("INSERT INTO transactions (type, category, amount, description, date) VALUES (?, ?, ?, ?, ?)");
        $stmt->bind_param("ssdss", $input['type'], $input['category'], $input['amount'], $input['description'], $input['date']);
        if ($stmt->execute())
            echo json_encode(["message" => "Berhasil disimpan"]);
        else {
            http_response_code(500);
            echo json_encode(["error" => $stmt->error]);
        }
    }
}

// === 3. PUT DATA (UPDATE) ===
elseif ($method == 'PUT') {
    $id = isset($_GET['id']) ? $_GET['id'] : 0;

    if ($mode == 'investment') {
        $stmt = $conn->prepare("UPDATE investments SET type=?, name=?, initial_amount=?, current_amount=?, last_updated=NOW() WHERE id=?");
        $stmt->bind_param("ssddi", $input['type'], $input['name'], $input['initial_amount'], $input['current_amount'], $id);

        if ($stmt->execute()) {
            // AUTO LOG HISTORY SAAT UPDATE
            $hist = $conn->prepare("INSERT INTO investment_history (investment_id, name, amount, date) VALUES (?, ?, ?, NOW())");
            $hist->bind_param("isd", $id, $input['name'], $input['current_amount']);
            $hist->execute();

            echo json_encode(["message" => "Berhasil diupdate"]);
        } else {
            http_response_code(500);
            echo json_encode(["error" => $stmt->error]);
        }
    } else {
        $stmt = $conn->prepare("UPDATE transactions SET type=?, category=?, amount=?, description=?, date=? WHERE id=?");
        $stmt->bind_param("ssdssi", $input['type'], $input['category'], $input['amount'], $input['description'], $input['date'], $id);
        if ($stmt->execute())
            echo json_encode(["message" => "Berhasil diupdate"]);
        else {
            http_response_code(500);
            echo json_encode(["error" => $stmt->error]);
        }
    }
}

// === 4. DELETE DATA (HAPUS) ===
elseif ($method == 'DELETE') {
    $id = isset($_GET['id']) ? $_GET['id'] : 0;

    if ($mode == 'investment') {
        // Hapus Aset dan Historinya
        $conn->query("DELETE FROM investment_history WHERE investment_id=$id");
        $stmt = $conn->prepare("DELETE FROM investments WHERE id=?");
    } else {
        $stmt = $conn->prepare("DELETE FROM transactions WHERE id=?");
    }

    $stmt->bind_param("i", $id);
    if ($stmt->execute())
        echo json_encode(["message" => "Berhasil dihapus"]);
    else {
        http_response_code(500);
        echo json_encode(["error" => $stmt->error]);
    }
}

$conn->close();
?>