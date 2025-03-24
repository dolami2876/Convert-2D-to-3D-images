import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Variables to track processing time
let processingStartTime = 0;
let viewerObject = null;

// Make the entire upload area clickable to trigger file input
document.addEventListener("DOMContentLoaded", function() {
    const uploadWrapper = document.getElementById("uploadWrapper");
    const fileInput = document.getElementById("fileInput");
    
    // When clicking anywhere in the upload area, trigger the file input
    uploadWrapper.addEventListener("click", function(e) {
        // Only trigger if we're not clicking on the preview image's overlay
        if (!e.target.closest('.image-preview-overlay')) {
            fileInput.click();
        }
    });
    
    // Add click handler for the "Change image" overlay
    const imagePreviewOverlay = document.querySelector(".image-preview-overlay");
    if (imagePreviewOverlay) {
        imagePreviewOverlay.addEventListener("click", function(e) {
            e.stopPropagation(); // Prevent propagation to the wrapper's click handler
            fileInput.click();
        });
    }
});

// Hiển thị ảnh preview khi người dùng chọn file
document.getElementById("fileInput").addEventListener("change", function(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const imgPreview = document.getElementById("imagePreview");
            imgPreview.innerHTML = "";
            const img = document.createElement("img");
            img.src = e.target.result;
            imgPreview.appendChild(img);
            
            // Thêm class để hiển thị border và overlay khi có ảnh
            document.getElementById("uploadWrapper").classList.add("has-image");
            
            // Show the overlay
            const overlay = document.querySelector(".image-preview-overlay");
            if (overlay) {
                overlay.style.display = "flex";
            }
        };
        reader.readAsDataURL(file);
    }
});

// Thêm hiệu ứng drag-and-drop cho vùng upload
const dropZone = document.getElementById("uploadWrapper");
dropZone.addEventListener("dragover", function(e) {
    e.preventDefault();
    dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", function() {
    dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", function(e) {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    
    if (e.dataTransfer.files.length) {
        document.getElementById("fileInput").files = e.dataTransfer.files;
        // Kích hoạt sự kiện change để hiển thị preview
        const changeEvent = new Event('change');
        document.getElementById("fileInput").dispatchEvent(changeEvent);
    }
});

// Khi người dùng nhấn nút "Generate 3D Model"
document.getElementById("uploadBtn").addEventListener("click", async function() {
    const fileInput = document.getElementById("fileInput");
    const file = fileInput.files[0];
    const generateMesh = document.getElementById("generateMesh").checked;

    if (!file) {
        showNotification("Vui lòng chọn một ảnh!", "error");
        return;
    }

    // Hiển thị trạng thái đang xử lý
    const viewer = document.getElementById("viewer");
    viewer.innerHTML = `
        <div class='loading'>
            <div class='loading-spinner'></div>
            <div class='loading-text'>Đang xử lý ảnh và tạo mô hình 3D...</div>
        </div>`;

    // Reset các thông tin thống kê
    document.getElementById("pointCount").textContent = "-";
    document.getElementById("faceCount").textContent = "-";
    document.getElementById("processingTime").textContent = "-";

    // Lưu thời điểm bắt đầu xử lý
    processingStartTime = performance.now();

    try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("generate_mesh", generateMesh);

        const response = await fetch("/upload", {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }

        const data = await response.json();
        
        // Tính thời gian xử lý
        const processingTime = ((performance.now() - processingStartTime) / 1000).toFixed(2);
        document.getElementById("processingTime").textContent = `${processingTime}s`;
        
        // Hiển thị số điểm
        document.getElementById("pointCount").textContent = data.point_cloud.length.toLocaleString();
        
        // Hiển thị số mặt nếu có mesh
        if (data.mesh) {
            document.getElementById("faceCount").textContent = data.mesh.faces.length.toLocaleString();
        } else {
            document.getElementById("faceCount").textContent = "0";
        }
        
        // Cấu hình scene và đối tượng 3D
        setupViewer(data);
        
        // Hiển thị thông báo thành công
        showNotification("Mô hình 3D đã được tạo thành công!", "success");
    } catch (error) {
        console.error("Error:", error);
        viewer.innerHTML = `<div class='loading'>Có lỗi xảy ra: ${error.message}</div>`;
        showNotification("Có lỗi xảy ra khi tạo mô hình 3D!", "error");
    }
});

// Hiển thị thông báo
function showNotification(message, type = "info") {
    // Tạo phần tử thông báo nếu chưa tồn tại
    let notification = document.getElementById("notification");
    if (!notification) {
        notification = document.createElement("div");
        notification.id = "notification";
        notification.className = "notification";
        document.body.appendChild(notification);
    }
    
    // Thêm class dựa trên loại thông báo
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        </div>
        <button class="notification-close">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    // Hiển thị thông báo
    notification.style.display = "flex";
    notification.classList.add("show");
    
    // Thêm sự kiện đóng thông báo
    notification.querySelector(".notification-close").addEventListener("click", function() {
        notification.classList.remove("show");
        setTimeout(() => {
            notification.style.display = "none";
        }, 300);
    });
    
    // Tự động ẩn sau 5 giây
    setTimeout(() => {
        if (notification.classList.contains("show")) {
            notification.classList.remove("show");
            setTimeout(() => {
                notification.style.display = "none";
            }, 300);
        }
    }, 5000);
}

// Thiết lập và hiển thị mô hình 3D (point cloud hoặc mesh)
function setupViewer(data) {
    // Xóa canvas cũ nếu có
    const viewer = document.getElementById("viewer");
    viewer.innerHTML = "";

    // Tạo scene, camera, renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    
    const width = viewer.clientWidth;
    const height = viewer.clientHeight;
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.z = 2;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    viewer.appendChild(renderer.domElement);

    // Tạo grid để hỗ trợ người dùng về không gian 3D
    const gridHelper = new THREE.GridHelper(5, 10, 0x444444, 0x222222);
    gridHelper.position.y = -0.8;
    scene.add(gridHelper);

    // Thêm điều khiển chuột (xoay, zoom)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.screenSpacePanning = false;
    controls.maxPolarAngle = Math.PI;
    controls.minDistance = 0.5;
    controls.maxDistance = 10;
    controls.update();

    // Thêm đèn
    setupLights(scene);

    // Xử lý dữ liệu và thêm vào scene
    let object3D;
    
    // Nếu có dữ liệu mesh và người dùng đã chọn tạo mesh
    if (data.mesh && document.getElementById("generateMesh").checked) {
        object3D = createMesh(data.mesh);
        document.getElementById("modelType").textContent = "Mesh";
        document.getElementById("viewModeToggle").checked = true;
    } else {
        // Ngược lại sử dụng point cloud
        object3D = createPointCloud(data.point_cloud);
        document.getElementById("modelType").textContent = "Point Cloud";
        document.getElementById("viewModeToggle").checked = false;
    }
    
    // Lưu object hiện tại vào biến toàn cục
    viewerObject = object3D;
    scene.add(object3D);

    // Thêm đối tượng để hiển thị trục tọa độ
    const axesHelper = new THREE.AxesHelper(0.5);
    axesHelper.position.set(-0.8, -0.8, -0.8);
    scene.add(axesHelper);

    // Xử lý sự kiện khi chuyển đổi chế độ hiển thị
    setupViewModeToggle(scene, object3D, data);

    // Xử lý thay đổi kích thước cửa sổ
    setupResizeHandler(viewer, camera, renderer);

    // Thêm nút điều khiển trợ giúp
    addViewerControls(viewer, scene, camera, controls);

    // Animation loop
    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }
    animate();
}

// Tạo point cloud từ dữ liệu
function createPointCloud(points) {
    // Lọc các điểm để loại bỏ nhiễu và giảm số lượng
    const stride = 1; // Có thể tăng lên để giảm số lượng điểm
    const filteredPoints = points.filter((_, index) => index % stride === 0);
    
    const vertices = [];
    const colors = [];

    // Tính toán giới hạn điểm để căn giữa point cloud
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    filteredPoints.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        minZ = Math.min(minZ, p.z);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
        maxZ = Math.max(maxZ, p.z);
    });
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    
    // Tính toán kích thước lớn nhất để chuẩn hóa
    const maxDimension = Math.max(maxX-minX, maxY-minY, maxZ-minZ);
    const scale = 1.5 / maxDimension;
    
    filteredPoints.forEach(p => {
        vertices.push(
            (p.x - centerX) * scale,
            (p.y - centerY) * scale,
            (p.z - centerZ) * scale
        );
        colors.push(p.r, p.g, p.b);
    });

    // Sử dụng BufferGeometry cho hiệu suất tốt hơn
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // Tạo Material với kích thước điểm phù hợp và shader tốt hơn
    const material = new THREE.PointsMaterial({
        vertexColors: true,
        size: 0.008,
        sizeAttenuation: true,
        map: createPointTexture(),
        alphaTest: 0.5,
        transparent: true
    });

    return new THREE.Points(geometry, material);
}

// Tạo texture tròn cho điểm để hiển thị mềm mại hơn
function createPointTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.arc(8, 8, 7, 0, 2 * Math.PI);
    context.fill();
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

// Tạo mesh từ dữ liệu
function createMesh(meshData) {
    const { vertices, faces, colors } = meshData;
    
    // Tính toán giới hạn điểm để căn giữa mesh
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    for (const v of vertices) {
        minX = Math.min(minX, v[0]);
        minY = Math.min(minY, v[1]);
        minZ = Math.min(minZ, v[2]);
        maxX = Math.max(maxX, v[0]);
        maxY = Math.max(maxY, v[1]);
        maxZ = Math.max(maxZ, v[2]);
    }
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    
    // Tính toán kích thước lớn nhất để chuẩn hóa
    const maxDimension = Math.max(maxX-minX, maxY-minY, maxZ-minZ);
    const scale = 1.5 / maxDimension;
    
    const geometry = new THREE.BufferGeometry();
    
    // Chuyển đổi vertices
    const vertexPositions = [];
    for (const v of vertices) {
        vertexPositions.push(
            (v[0] - centerX) * scale,
            (v[1] - centerY) * scale,
            (v[2] - centerZ) * scale
        );
    }
    
    // Chuyển đổi faces
    const indices = [];
    for (const face of faces) {
        indices.push(face[0], face[1], face[2]);
    }
    
    // Chuyển đổi colors
    const vertexColors = [];
    for (const color of colors) {
        vertexColors.push(color[0], color[1], color[2]);
    }
    
    // Thiết lập các thuộc tính của geometry
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertexPositions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));
    
    // Tính toán normal vectors
    geometry.computeVertexNormals();
    
    // Tạo material nâng cao
    const material = new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        flatShading: false,
        roughness: 0.7,
        metalness: 0.1,
        reflectivity: 0.2,
        clearcoat: 0.1,
        clearcoatRoughness: 0.4,
        side: THREE.DoubleSide
    });
    
    // Tạo mesh có bóng đổ
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
    return mesh;
}

// Thiết lập ánh sáng nâng cao
function setupLights(scene) {
    // Ánh sáng môi trường
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    
    // Ánh sáng chính
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
    mainLight.position.set(0, 1, 1);
    mainLight.castShadow = true;
    
    // Cấu hình bóng đổ chất lượng cao
    mainLight.shadow.mapSize.width = 1024;
    mainLight.shadow.mapSize.height = 1024;
    mainLight.shadow.camera.near = 0.1;
    mainLight.shadow.camera.far = 10;
    mainLight.shadow.camera.left = -3;
    mainLight.shadow.camera.right = 3;
    mainLight.shadow.camera.top = 3;
    mainLight.shadow.camera.bottom = -3;
    mainLight.shadow.bias = -0.001;
    
    scene.add(mainLight);
    
    // Ánh sáng phụ
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(0, -1, -1);
    scene.add(fillLight);
    
    // Thêm ánh sáng điểm để tạo hiệu ứng đổ bóng tốt hơn
    const pointLight1 = new THREE.PointLight(0xffffff, 0.5);
    pointLight1.position.set(2, 2, 2);
    scene.add(pointLight1);
    
    const pointLight2 = new THREE.PointLight(0xffffff, 0.3);
    pointLight2.position.set(-2, -1, -1);
    scene.add(pointLight2);
}

// Xử lý thay đổi kích thước cửa sổ
function setupResizeHandler(viewer, camera, renderer) {
    window.addEventListener('resize', () => {
        const width = viewer.clientWidth;
        const height = viewer.clientHeight;
        
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
    });
}

// Thiết lập chuyển đổi giữa các chế độ hiển thị
function setupViewModeToggle(scene, currentObject, data) {
    const viewModeToggle = document.getElementById("viewModeToggle");
    
    // Kiểm tra nếu có dữ liệu mesh
    if (!data.mesh) {
        viewModeToggle.disabled = true;
        viewModeToggle.parentElement.title = "Không có dữ liệu mesh";
        return;
    }
    
    viewModeToggle.disabled = false;
    viewModeToggle.parentElement.title = "";
    
    // Khởi tạo trạng thái chuyển đổi
    viewModeToggle.checked = currentObject instanceof THREE.Mesh;
    
    // Xử lý sự kiện khi chuyển đổi chế độ hiển thị
    viewModeToggle.addEventListener("change", function() {
        scene.remove(currentObject);
        
        if (this.checked) {
            // Hiển thị mesh
            currentObject = createMesh(data.mesh);
            document.getElementById("modelType").textContent = "Mesh";
        } else {
            // Hiển thị point cloud
            currentObject = createPointCloud(data.point_cloud);
            document.getElementById("modelType").textContent = "Point Cloud";
        }
        
        viewerObject = currentObject;
        scene.add(currentObject);
    });
}

// Thêm các điều khiển trợ giúp cho người dùng
function addViewerControls(viewer, scene, camera, controls) {
    // Tạo container cho các nút điều khiển
    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'viewer-controls';
    
    // Nút reset góc nhìn
    const resetViewBtn = document.createElement('button');
    resetViewBtn.className = 'viewer-control-btn';
    resetViewBtn.innerHTML = '<i class="fas fa-home"></i>';
    resetViewBtn.title = 'Khôi phục góc nhìn';
    resetViewBtn.addEventListener('click', () => {
        camera.position.set(0, 0, 2);
        camera.lookAt(0, 0, 0);
        controls.target.set(0, 0, 0);
        controls.update();
    });
    
    // Nút xoay tự động
    const autoRotateBtn = document.createElement('button');
    autoRotateBtn.className = 'viewer-control-btn';
    autoRotateBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
    autoRotateBtn.title = 'Xoay tự động';
    
    let autoRotating = false;
    autoRotateBtn.addEventListener('click', () => {
        autoRotating = !autoRotating;
        controls.autoRotate = autoRotating;
        autoRotateBtn.classList.toggle('active', autoRotating);
    });
    
    // Nút toàn màn hình
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = 'viewer-control-btn';
    fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
    fullscreenBtn.title = 'Toàn màn hình';
    
    fullscreenBtn.addEventListener('click', () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
            fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
        } else {
            viewer.requestFullscreen();
            fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
        }
    });
    
    // Nút chụp ảnh
    const screenshotBtn = document.createElement('button');
    screenshotBtn.className = 'viewer-control-btn';
    screenshotBtn.innerHTML = '<i class="fas fa-camera"></i>';
    screenshotBtn.title = 'Chụp ảnh';
    
    screenshotBtn.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = 'model-screenshot.png';
        link.href = viewer.querySelector('canvas').toDataURL('image/png');
        link.click();
    });
    
    // Thêm các nút vào container
    controlsContainer.appendChild(resetViewBtn);
    controlsContainer.appendChild(autoRotateBtn);
    controlsContainer.appendChild(fullscreenBtn);
    controlsContainer.appendChild(screenshotBtn);
    
    // Thêm container vào viewer
    viewer.appendChild(controlsContainer);
}

// Thêm các sự kiện khởi tạo
window.addEventListener('DOMContentLoaded', () => {
    // Hiển thị thông báo chào mừng
    setTimeout(() => {
        showNotification("Chào mừng đến với RGB to 3D Model Converter!", "info");
    }, 1000);
    
    // Khởi tạo viewer trống
    const viewer = document.getElementById("viewer");
    viewer.innerHTML = `
        <div class='loading'>
            <i class="fas fa-cube" style="font-size: 48px; margin-bottom: 20px;"></i>
            <div class='loading-text'>Tải ảnh và nhấn nút "Tạo mô hình 3D" để bắt đầu</div>
        </div>
    `;
    
    // Make sure the image preview overlay starts hidden
    const overlay = document.querySelector(".image-preview-overlay");
    if (overlay) {
        overlay.style.display = "none";
    }
    
    // Thêm style cho các phần tử mới
    const style = document.createElement('style');
    style.textContent = `
        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            background-color: white;
            border-radius: 8px;
            padding: 15px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: none;
            align-items: center;
            justify-content: space-between;
            z-index: 1000;
            max-width: 400px;
            min-width: 300px;
            transform: translateX(100%);
            transition: transform 0.3s ease;
        }
        
        .notification.show {
            transform: translateX(0);
        }
        
        .notification-content {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .notification i {
            font-size: 20px;
        }
        
        .notification-close {
            background: none;
            border: none;
            cursor: pointer;
            font-size: 14px;
            color: #777;
            padding: 5px;
        }
        
        .notification.success i {
            color: var(--secondary-color);
        }
        
        .notification.error i {
            color: var(--accent-color);
        }
        
        .notification.info i {
            color: var(--primary-color);
        }
        
        .viewer-controls {
            position: absolute;
            top: 10px;
            right: 10px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        
        .viewer-control-btn {
            background-color: rgba(255, 255, 255, 0.2);
            border: none;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            color: white;
            font-size: 16px;
            transition: background-color 0.2s;
        }
        
        .viewer-control-btn:hover {
            background-color: rgba(255, 255, 255, 0.3);
        }
        
        .viewer-control-btn.active {
            background-color: var(--primary-color);
        }
        
        .drag-over {
            border-color: var(--primary-color);
            background-color: rgba(66, 133, 244, 0.2);
        }
        
        /* Make the file input properly hidden */
        #fileInput {
            position: absolute;
            width: 0.1px;
            height: 0.1px;
            opacity: 0;
            overflow: hidden;
            z-index: -1;
        }
        
        /* Style for the upload wrapper */
        .file-input-wrapper {
            position: relative;
            cursor: pointer;
        }
        
        /* Style for the image preview overlay */
        .image-preview-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.5);
            color: white;
            display: none;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            border-radius: 8px;
        }
        
        /* Show overlay when there is an image */
        .file-input-wrapper.has-image .image-preview-overlay {
            display: flex;
        }
        
        /* Style for the image preview */
        #imagePreview {
            width: 100%;
            height: 100%;
            position: absolute;
            top: 0;
            left: 0;
            z-index: 1;
            border-radius: 8px;
            overflow: hidden;
        }
        
        #imagePreview img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
        
        /* Style to hide the upload content when an image is loaded */
        .file-input-wrapper.has-image .upload-content {
            opacity: 0;
        }
    `;
    document.head.appendChild(style);
});

// Hàm export model
function exportModel(format) {
    if (!viewerObject) {
        showNotification("Không có mô hình để xuất!", "error");
        return;
    }
    
    // Tạo các hàm xuất khác nhau tùy theo format
    // Đây là phần mẫu, cần thêm các hàm xuất thực tế
    switch(format) {
        case 'obj':
            showNotification("Chức năng xuất OBJ sẽ sớm được hỗ trợ!", "info");
            break;
        case 'stl':
            showNotification("Chức năng xuất STL sẽ sớm được hỗ trợ!", "info");
            break;
        case 'ply':
            showNotification("Chức năng xuất PLY sẽ sớm được hỗ trợ!", "info");
            break;
        case 'gltf':
            showNotification("Chức năng xuất glTF sẽ sớm được hỗ trợ!", "info");
            break;
        default:
            showNotification("Định dạng không được hỗ trợ!", "error");
    }
}