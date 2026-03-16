
import numpy as np

def quat_to_matrix(q):
    x, y, z, w = q
    return np.array([
        [1 - 2*y*y - 2*z*z,     2*x*y - 2*z*w,       2*x*z + 2*y*w],
        [2*x*y + 2*z*w,         1 - 2*x*x - 2*z*z,   2*y*z - 2*x*w],
        [2*x*z - 2*y*w,         2*y*z + 2*x*w,       1 - 2*x*x - 2*y*y]
    ])

def matrix_to_euler(M):
    sy = np.sqrt(M[0,0] * M[0,0] + M[1,0] * M[1,0])
    singular = sy < 1e-6
    if not singular:
        x = np.arctan2(M[2,1], M[2,2])
        y = np.arctan2(-M[2,0], sy)
        z = np.arctan2(M[1,0], M[0,0])
    else:
        x = np.arctan2(-M[1,2], M[1,1])
        y = np.arctan2(-M[2,0], sy)
        z = 0
    return np.rad2deg(np.array([x, y, z]))

# From previous output
q14 = [-0.4997049, -0.0800700858, 0.0265318528, 0.862078846] # robo_shoulder.L
q82 = [-0.5759289, -0.4044361, -0.483463019, 0.520577431]    # shoulder.L

m14 = quat_to_matrix(q14)
m82 = quat_to_matrix(q82)

# Difference matrix D such that m14 = D * m82  => D = m14 * m82.T
diff = m14 @ m82.T
euler = matrix_to_euler(diff)

print(f"Euler difference (degrees): {euler}")

# Also check upper arm
q15 = [0.12278755, 0.745254338, -0.0188175477, 0.655107]
q83 = [0.127010882, 0.734226644, -0.0166813079, 0.666709244]
diff15 = quat_to_matrix(q15) @ quat_to_matrix(q83).T
print(f"Upper Arm Euler difference: {matrix_to_euler(diff15)}")
