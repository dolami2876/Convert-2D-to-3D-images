import open3d as o3d

# Đọc file .ply
pcd = o3d.io.read_point_cloud("mmesh_bpa.ply")

# Hiển thị Point Cloud
o3d.visualization.draw_geometries([pcd])
