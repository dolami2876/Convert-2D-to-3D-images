import sys
import os
sys.path.append(os.path.abspath("./Depth-Anything-V2"))

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import torch
from PIL import Image
import io
import open3d as o3d
from scipy.spatial import Delaunay

from depth_anything_v2.dpt import DepthAnythingV2

# Khởi tạo FastAPI
app = FastAPI()

# Thêm CORS middleware để tránh vấn đề cross-origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gắn thư mục "static" để phục vụ giao diện web
app.mount("/static", StaticFiles(directory="static"), name="static")

# Load mô hình Depth Anything V2
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
try:
    model = DepthAnythingV2(encoder="vitl")
    model.load_state_dict(torch.load("depth_anything_v2_vitl.pth", map_location=DEVICE))
    model.to(DEVICE).eval()
    print(f"Đã tải model thành công, sử dụng device: {DEVICE}")
except Exception as e:
    print(f"Lỗi khi tải model: {e}")
    model = None

def depth_to_point_cloud(depth_map, image):
    """Chuyển depth map thành danh sách điểm 3D với màu sắc"""
    h, w = depth_map.shape
    
    # Focal length (ước tính, thay đổi nếu cần)
    f = max(h, w) * 0.85
    
    # Tạo lưới tọa độ x, y
    x, y = np.meshgrid(np.arange(w), np.arange(h))
    x = (x - w / 2) / f
    y = (y - h / 2) / f
    
    # Scale depth map để có depth hợp lý
    z = depth_map * 2.0
    
    # Tạo cloud điểm (x, y, z) với màu sắc
    points = np.stack((np.multiply(x, z), np.multiply(y, z), z), axis=-1)
    colors = np.array(image).reshape(-1, 3) / 255.0
    
    # Subsample để giảm kích thước
    step = 8  # Lấy mỗi điểm thứ 8, có thể điều chỉnh
    points = points.reshape(-1, 3)[::step]
    colors = colors[::step]
    
    # Lọc một số điểm không hợp lệ
    valid_indices = ~np.isnan(points).any(axis=1)
    points = points[valid_indices]
    colors = colors[valid_indices]
    
    # Chuyển sang định dạng JSON
    point_cloud = [
        {"x": float(p[0]), "y": float(p[1]), "z": float(p[2]), 
         "r": float(c[0]), "g": float(c[1]), "b": float(c[2])} 
        for p, c in zip(points, colors)
    ]
    
    return point_cloud, points, colors

def create_mesh_from_points(points, colors, max_points=5000):
    """Chuyển đổi point cloud thành mesh 3D"""
    # Giảm số lượng điểm để xử lý nhanh hơn
    if len(points) > max_points:
        indices = np.random.choice(len(points), max_points, replace=False)
        filtered_points = points[indices]
        filtered_colors = colors[indices]
    else:
        filtered_points = points
        filtered_colors = colors
    
    # Đưa các điểm vào không gian 2D cho thuật toán tam giác hóa
    # Sử dụng chiếu từ không gian 3D xuống mặt phẳng XY
    points_2d = filtered_points[:, :2]
    
    try:
        # Tạo lưới tam giác bằng thuật toán Delaunay
        tri = Delaunay(points_2d)
        
        # Lọc các tam giác có cạnh quá dài
        faces = []
        max_edge_length = 0.05  # Ngưỡng cho độ dài cạnh, điều chỉnh theo nhu cầu
        
        for simplex in tri.simplices:
            valid = True
            # Kiểm tra độ dài các cạnh
            for i in range(3):
                for j in range(i+1, 3):
                    p1 = filtered_points[simplex[i]]
                    p2 = filtered_points[simplex[j]]
                    dist = np.linalg.norm(p1 - p2)
                    if dist > max_edge_length:
                        valid = False
                        break
                if not valid:
                    break
            
            if valid:
                faces.append(simplex.tolist())
        
        # Tạo vertex colors
        vertex_colors = filtered_colors.tolist()
        
        # Tạo mesh data
        mesh_data = {
            "vertices": filtered_points.tolist(),
            "faces": faces,
            "colors": vertex_colors
        }
        
        return mesh_data
        
    except Exception as e:
        print(f"Lỗi khi tạo mesh: {str(e)}")
        return None

def create_mesh_3d(points, colors):
    """Phương pháp thay thế sử dụng Open3D để tạo mesh từ point cloud"""
    # Tạo point cloud
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(points)
    pcd.colors = o3d.utility.Vector3dVector(colors)
    
    # Ước tính normal vectors
    pcd.estimate_normals(search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=0.1, max_nn=30))
    
    # Poisson surface reconstruction
    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        pcd, depth=8, width=0, scale=1.1, linear_fit=False
    )
    
    # Cắt bỏ các tam giác có mật độ thấp
    vertices = np.asarray(mesh.vertices)
    triangles = np.asarray(mesh.triangles)
    
    # Nội suy màu từ point cloud sang mesh
    vertex_colors = np.zeros_like(vertices)
    pcd_tree = o3d.geometry.KDTreeFlann(pcd)
    
    for i, vertex in enumerate(vertices):
        [_, idx, _] = pcd_tree.search_knn_vector_3d(vertex, 1)
        vertex_colors[i] = colors[idx[0]]
    
    # Tạo mesh data
    mesh_data = {
        "vertices": vertices.tolist(),
        "faces": triangles.tolist(),
        "colors": vertex_colors.tolist()
    }
    
    return mesh_data

@app.get("/")
async def serve_index():
    """Trả về trang giao diện web"""
    return FileResponse("static/index.html")

@app.post("/upload")
async def upload_file(file: UploadFile = File(...), generate_mesh: bool = Form(False)):
    """API nhận ảnh RGB, trả về Point Cloud và tùy chọn Mesh"""
    if not model:
        raise HTTPException(status_code=500, detail="Model chưa được tải đúng cách")
    
    try:
        # Đọc ảnh từ file upload
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert("RGB")
        
        # Resize ảnh nếu kích thước quá lớn để giảm thời gian xử lý
        max_size = 640
        orig_width, orig_height = image.size
        if max(orig_width, orig_height) > max_size:
            scale = max_size / max(orig_width, orig_height)
            new_width = int(orig_width * scale)
            new_height = int(orig_height * scale)
            image = image.resize((new_width, new_height), Image.LANCZOS)
            print(f"Đã resize ảnh từ {orig_width}x{orig_height} thành {new_width}x{new_height}")
        
        # Chuyển đổi ảnh sang định dạng mà model có thể xử lý
        image_cv = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        
        # Tạo depth map
        with torch.no_grad():
            depth_map = model.infer_image(image_cv, image_cv.shape[0])
        
        # Chuyển depth map thành Point Cloud
        point_cloud_json, points_np, colors_np = depth_to_point_cloud(depth_map, image)
        print(f"Đã tạo point cloud với {len(point_cloud_json)} điểm")
        
        result = {"point_cloud": point_cloud_json}
        
        # Tạo mesh nếu được yêu cầu
        if generate_mesh:
            try:
                # Thử phương pháp Open3D trước
                try:
                    mesh_data = create_mesh_3d(points_np, colors_np)
                except:
                    # Dùng phương pháp Delaunay nếu Open3D thất bại
                    mesh_data = create_mesh_from_points(points_np, colors_np)
                
                if mesh_data:
                    result["mesh"] = mesh_data
                    print(f"Đã tạo mesh với {len(mesh_data['vertices'])} đỉnh và {len(mesh_data['faces'])} mặt")
            except Exception as mesh_error:
                print(f"Lỗi tạo mesh: {str(mesh_error)}")
                # Vẫn trả về point cloud nếu tạo mesh thất bại
        
        return JSONResponse(content=result)
        
    except Exception as e:
        print(f"Error processing image: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Lỗi xử lý ảnh: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8001)
